/**
 * File-based routing: scan `src/routes` and write `routeTree.gen.ts`.
 *
 * File naming (a subset of TanStack Router's conventions):
 *   __root.tsx              root route (document shell)
 *   index.tsx               "/"
 *   about.tsx               "/about"
 *   posts.tsx               layout for "/posts/*" (renders <Outlet />)
 *   posts/route.tsx         same as posts.tsx
 *   posts.index.tsx         "/posts" (index inside the layout)
 *   posts.$postId.tsx       "/posts/:postId"   (dots or folders both nest)
 *   files.$.tsx             splat: "/files/*"  -> params._splat
 *   _auth.tsx               pathless layout (wraps children, adds no URL segment)
 *   (group)/...             folder ignored in ids and URLs
 *   -components/...         ignored (prefix with "-" to colocate non-route files)
 */
import fs from 'node:fs'
import path from 'node:path'

const ROUTE_FILE = /\.(tsx|ts|jsx|js)$/
const IGNORED_FILE = /\.(test|spec)\.[jt]sx?$|\.d\.ts$/

export interface RouteNode {
  file: string
  importPath: string
  id: string
  /** id segments without the trailing "index" */
  segments: string[]
  isRoot: boolean
  isIndex: boolean
  isPathless: boolean
  serverOnly: boolean
  /** path relative to the parent route */
  path: string
  fullPath: string
  parent: RouteNode | undefined
  varName: string
  importName: string
}

export function scanRouteFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('-') || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...scanRouteFiles(full))
    else if (ROUTE_FILE.test(entry.name) && !IGNORED_FILE.test(entry.name)) {
      out.push(full)
    }
  }
  return out.sort()
}

function toPascal(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase() + p.slice(1))
    .join('')
}

export function buildRouteNodes(routesDir: string, outFile: string): RouteNode[] {
  const outDir = path.dirname(outFile)
  const nodes: RouteNode[] = []
  const ids = new Map<string, string>()
  const names = new Set<string>()

  for (const file of scanRouteFiles(routesDir)) {
    const rel = path.relative(routesDir, file).split(path.sep).join('/').replace(ROUTE_FILE, '')
    const isRoot = rel === '__root'
    let parts = isRoot
      ? []
      : rel
          .split('/')
          .flatMap((p) => p.split('.'))
          .filter((p) => p && !/^\(.*\)$/.test(p))
    if (parts.at(-1) === 'route') parts = parts.slice(0, -1)
    const isIndex = !isRoot && (parts.at(-1) === 'index' || parts.length === 0)
    if (parts.at(-1) === 'index') parts = parts.slice(0, -1)

    const id = isRoot
      ? '__root__'
      : `/${parts.join('/')}${isIndex && parts.length ? '/' : ''}`
    const previous = ids.get(id)
    if (previous) {
      throw new Error(`Routes "${previous}" and "${rel}" both resolve to "${id}"`)
    }
    ids.set(id, rel)

    const source = fs.readFileSync(file, 'utf8')
    const base = isRoot ? 'root' : toPascal(`${parts.join(' ')} ${isIndex ? 'index' : ''}`) || 'Index'
    let varName = `${base}Route`
    for (let n = 2; names.has(varName); n++) varName = `${base}Route${n}`
    names.add(varName)

    let importPath = path.relative(outDir, file).split(path.sep).join('/').replace(ROUTE_FILE, '')
    if (!importPath.startsWith('.')) importPath = `./${importPath}`

    nodes.push({
      file,
      importPath,
      id,
      segments: parts,
      isRoot,
      isIndex,
      isPathless: false,
      serverOnly: /\bserver\s*:/.test(source) && !/\bcomponent\s*:/.test(source),
      path: '',
      fullPath: '/',
      parent: undefined,
      varName,
      importName: `${varName}Import`,
    })
  }

  const root = nodes.find((n) => n.isRoot)
  if (!root) throw new Error(`Missing ${path.join(routesDir, '__root.tsx')}`)

  const layouts = new Map(
    nodes.filter((n) => !n.isRoot && !n.isIndex).map((n) => [n.segments.join('/'), n]),
  )
  for (const node of nodes) {
    if (node.isRoot) continue
    // Nearest existing layout whose segments are a prefix of ours.
    let parent: RouteNode = root
    for (let len = node.isIndex ? node.segments.length : node.segments.length - 1; len > 0; len--) {
      const candidate = layouts.get(node.segments.slice(0, len).join('/'))
      if (candidate) {
        parent = candidate
        break
      }
    }
    node.parent = parent
    const urlSegments = node.segments.slice(parent.segments.length).filter((s) => !s.startsWith('_'))
    node.path = node.isIndex ? '/' : urlSegments.join('/')
    node.isPathless = !node.isIndex && urlSegments.length === 0
    const allUrlSegments = node.segments.filter((s) => !s.startsWith('_'))
    node.fullPath = `/${allUrlSegments.join('/')}${node.isIndex && allUrlSegments.length ? '/' : ''}`
  }

  // Parents first, so generated code can reference them.
  return nodes.sort((a, b) => (a.isRoot ? -1 : b.isRoot ? 1 : a.segments.length - b.segments.length || a.id.localeCompare(b.id)))
}

/** The path users write in <Link to>: index routes drop the trailing slash. */
function toPath(node: RouteNode): string {
  return node.fullPath.length > 1 ? node.fullPath.replace(/\/$/, '') : '/'
}

export function renderRouteTree(nodes: RouteNode[]): string {
  const root = nodes.find((n) => n.isRoot) as RouteNode
  const children = new Map<RouteNode, RouteNode[]>()
  for (const node of nodes) {
    if (!node.parent) continue
    children.set(node.parent, [...(children.get(node.parent) ?? []), node])
  }

  const lines: string[] = [
    '/* eslint-disable */',
    '// This file is generated by mini-start from the files in src/routes.',
    '// Do not edit it: it is rewritten whenever a route file is added, removed or renamed.',
    '',
  ]
  for (const node of nodes) {
    lines.push(`import { Route as ${node.importName} } from '${node.importPath}'`)
  }
  lines.push('')
  for (const node of nodes) {
    if (node.isRoot) continue
    const opts = [
      `id: '${node.id}'`,
      `path: '${node.path}'`,
      `fullPath: '${node.fullPath}'`,
      `parent: ${node.parent?.isRoot ? root.importName : node.parent?.varName}`,
      node.isIndex ? 'isIndex: true' : '',
      node.serverOnly ? 'serverOnly: true' : '',
    ].filter(Boolean)
    lines.push(`const ${node.varName} = ${node.importName}._init({ ${opts.join(', ')} })`)
  }
  lines.push('')
  for (const node of [...nodes].reverse()) {
    const kids = children.get(node)
    if (!kids?.length || node.isRoot) continue
    lines.push(`${node.varName}._addChildren([${kids.map((k) => k.varName).join(', ')}])`)
  }
  const rootKids = children.get(root) ?? []
  lines.push(
    `export const routeTree = ${root.importName}._addChildren([${rootKids.map((k) => k.varName).join(', ')}])`,
    '',
  )

  // Type registration: the id -> route map for createFileRoute, and the
  // navigable path -> route map for <Link to>, params and search.
  const navigable = new Map<string, RouteNode>()
  if (!nodes.some((n) => n.isIndex && toPath(n) === '/')) navigable.set('/', root)
  for (const node of nodes) {
    if (node.isRoot || node.isPathless || node.serverOnly) continue
    const key = toPath(node)
    const existing = navigable.get(key)
    if (!existing || node.isIndex || existing.isRoot) navigable.set(key, node)
  }
  lines.push("declare module 'mini-start' {", '  interface FileRoutesByPath {')
  for (const node of nodes) {
    if (node.isRoot) continue
    lines.push(`    '${node.id}': { id: '${node.id}'; fullPath: '${node.fullPath}' }`)
  }
  lines.push('  }', '  interface RegisteredRoutes {')
  for (const [key, node] of navigable) {
    lines.push(`    '${key}': typeof ${node.importName}`)
  }
  lines.push('  }', '}', '')

  // Dev: a changed route file propagates its HMR update to this module, which
  // swaps the new tree into the running router instead of reloading the page.
  lines.push(
    'if (import.meta.hot) {',
    '  import.meta.hot.accept((next) => {',
    '    if (next?.routeTree) routeTree._hotReplace(next.routeTree)',
    '  })',
    '}',
    '',
  )
  return lines.join('\n')
}

function scaffold(node: RouteNode): string {
  return `import { createFileRoute } from 'mini-start'

export const Route = createFileRoute('${node.id}')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "${node.id}"!</div>
}
`
}

const CREATE_FILE_ROUTE = /createFileRoute\(\s*(['"`])([^'"`]*)\1\s*\)/

/** Keep each route file's createFileRoute('<id>') in sync with its location; scaffold empty files. */
function syncRouteFiles(nodes: RouteNode[]) {
  for (const node of nodes) {
    if (node.isRoot) continue
    const source = fs.readFileSync(node.file, 'utf8')
    if (source.trim() === '' && node.file.endsWith('x')) {
      fs.writeFileSync(node.file, scaffold(node))
      continue
    }
    const match = CREATE_FILE_ROUTE.exec(source)
    if (match && match[2] !== node.id) {
      fs.writeFileSync(node.file, source.replace(CREATE_FILE_ROUTE, `createFileRoute('${node.id}')`))
    }
  }
}

/** Returns true when the generated file changed. */
export function generateRouteTree(opts: { routesDir: string; outFile: string }): boolean {
  const nodes = buildRouteNodes(opts.routesDir, opts.outFile)
  syncRouteFiles(nodes)
  const content = renderRouteTree(nodes)
  const current = fs.existsSync(opts.outFile) ? fs.readFileSync(opts.outFile, 'utf8') : ''
  if (current === content) return false
  fs.writeFileSync(opts.outFile, content)
  return true
}
