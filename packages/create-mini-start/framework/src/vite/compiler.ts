/**
 * The mini-start compiler (runs as a Vite `transform`, after TS/JSX have
 * been stripped, on every app module that mentions a mini-start factory).
 *
 * For each environment it rewrites:
 *
 *   createServerFn(opts).handler(async () => { ...server code... })
 *     client -> createServerFn(opts).handler(__mini_createClientRpc("<id>", "/_serverFn/"))
 *     server -> createServerFn(opts).handler(async () => {...}, { id: "<id>", url: "..." })
 *
 *   createFileRoute('/x')({ server: { handlers }, component })
 *     client -> createFileRoute('/x')({ component })
 *
 * then (client only) removes declarations and imports that were only used by
 * the removed code, so server-only modules never reach the browser bundle.
 *
 * This is the same job TanStack Start's start-compiler does with Babel
 * (handleCreateServerFn.ts + dead-code elimination), done here with the
 * ESTree AST Vite already provides and plain string edits.
 */
import { createHash } from 'node:crypto'
import path from 'node:path'

// Minimal ESTree node shape (Vite's parseAst returns standard ESTree with offsets).
export interface Node {
  type: string
  start: number
  end: number
  [key: string]: any
}

interface Edit {
  start: number
  end: number
  text: string
}

export interface CompileOptions {
  code: string
  /** Absolute path of the module (without query). */
  id: string
  root: string
  env: 'client' | 'server'
  serverFnBase: string
  parse: (code: string) => Node
}

export interface CompileResult {
  code: string
  serverFns: Array<{ id: string; name: string }>
}

const MINI_START = 'mini-start'
const RPC_LOCAL = '__mini_createClientRpc'

export function serverFnId(relativeFile: string, name: string): string {
  return createHash('sha256').update(`${relativeFile}::${name}`).digest('hex').slice(0, 16)
}

export function compile(options: CompileOptions): CompileResult | null {
  const { code, env } = options
  const mentionsServerFn = code.includes('createServerFn')
  const mentionsRouteServer =
    env === 'client' &&
    /\bserver\s*:/.test(code) &&
    (code.includes('createFileRoute') || code.includes('createRootRoute'))
  if (!mentionsServerFn && !mentionsRouteServer) return null

  const ast = options.parse(code)
  const locals = collectFactoryImports(ast)
  if (
    locals.createServerFn.size === 0 &&
    locals.createFileRoute.size === 0 &&
    locals.createRootRoute.size === 0
  ) {
    return null
  }

  const relativeFile = path.relative(options.root, options.id).split(path.sep).join('/')
  const edits: Edit[] = []
  const removed: Array<[number, number]> = []
  const serverFns: CompileResult['serverFns'] = []
  const usedNames = new Map<string, number>()

  const uniqueName = (name: string) => {
    const count = usedNames.get(name) ?? 0
    usedNames.set(name, count + 1)
    return count === 0 ? name : `${name}_${count + 1}`
  }

  walk(ast, (node, ancestors) => {
    if (node.type !== 'CallExpression') return

    // --- createServerFn(...)[.validator(...)].handler(fn) -------------------
    const callee = node.callee as Node
    if (
      callee.type === 'MemberExpression' &&
      !callee.computed &&
      callee.property.type === 'Identifier' &&
      callee.property.name === 'handler' &&
      isServerFnChain(callee.object, locals.createServerFn)
    ) {
      const implementation = node.arguments[0] as Node | undefined
      if (!implementation) return 'skip'
      const name = uniqueName(bindingName(ancestors) ?? 'anonymous')
      const id = serverFnId(relativeFile, name)
      serverFns.push({ id, name })
      if (env === 'client') {
        const replacement = `${RPC_LOCAL}(${JSON.stringify(id)}, ${JSON.stringify(options.serverFnBase)})`
        edits.push(removal(code, implementation.start, implementation.end, replacement))
        removed.push([implementation.start, implementation.end])
      } else {
        const meta = `, { id: ${JSON.stringify(id)}, url: ${JSON.stringify(options.serverFnBase + id)} }`
        edits.push({ start: implementation.end, end: implementation.end, text: meta })
      }
      return 'skip'
    }

    // --- client: drop `server: { handlers }` from route options -------------
    if (env === 'client' && isRouteFactoryCall(node, locals)) {
      const routeOptions = node.arguments[0] as Node | undefined
      if (routeOptions?.type !== 'ObjectExpression') return
      for (const prop of routeOptions.properties as Node[]) {
        if (prop.type === 'Property' && !prop.computed && propertyKey(prop.key) === 'server') {
          const end = extendOverComma(code, prop.end)
          edits.push(removal(code, prop.start, end, ''))
          removed.push([prop.start, end])
        }
      }
    }
    return undefined
  })

  if (edits.length === 0) return null

  if (env === 'client' && removed.length > 0) {
    eliminateDeadCode(ast, code, removed, edits)
  }

  let output = applyEdits(code, edits)
  if (env === 'client' && serverFns.length > 0) {
    // Appended (imports are hoisted) so line numbers above stay intact.
    output += `\nimport { createClientRpc as ${RPC_LOCAL} } from "mini-start/client-rpc";\n`
  }
  return { code: output, serverFns }
}

// ---------------------------------------------------------------------------
// Pattern helpers
// ---------------------------------------------------------------------------

function collectFactoryImports(ast: Node) {
  const locals = {
    createServerFn: new Set<string>(),
    createFileRoute: new Set<string>(),
    createRootRoute: new Set<string>(),
  }
  for (const stmt of ast.body as Node[]) {
    if (stmt.type !== 'ImportDeclaration' || stmt.source.value !== MINI_START) continue
    for (const spec of stmt.specifiers as Node[]) {
      if (spec.type !== 'ImportSpecifier') continue
      const imported = spec.imported.type === 'Identifier' ? spec.imported.name : spec.imported.value
      if (imported in locals) locals[imported as keyof typeof locals].add(spec.local.name)
    }
  }
  return locals
}

/** Walk `a(...).b(...).c` back to its root and check it is `createServerFn(...)`. */
function isServerFnChain(node: Node, names: Set<string>): boolean {
  let current: Node | undefined = node
  while (current) {
    if (current.type === 'CallExpression') {
      const callee = current.callee as Node
      if (callee.type === 'Identifier') return names.has(callee.name)
      current = callee
    } else if (current.type === 'MemberExpression') {
      current = current.object
    } else {
      return false
    }
  }
  return false
}

function isRouteFactoryCall(node: Node, locals: ReturnType<typeof collectFactoryImports>) {
  const callee = node.callee as Node
  // createRootRoute({...})
  if (callee.type === 'Identifier') return locals.createRootRoute.has(callee.name)
  // createFileRoute('/x')({...})
  return (
    callee.type === 'CallExpression' &&
    callee.callee.type === 'Identifier' &&
    locals.createFileRoute.has(callee.callee.name)
  )
}

/** The variable a server function is assigned to (used to build a stable id). */
function bindingName(ancestors: Node[]): string | undefined {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const node = ancestors[i] as Node
    if (node.type === 'CallExpression' || node.type === 'MemberExpression') continue
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') return node.id.name
    if (node.type === 'ExportDefaultDeclaration') return 'default'
    if (node.type === 'Property' && !node.computed) return propertyKey(node.key)
    return undefined
  }
  return undefined
}

function propertyKey(key: Node): string | undefined {
  if (key.type === 'Identifier') return key.name
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value
  return undefined
}

function extendOverComma(code: string, end: number): number {
  let i = end
  while (i < code.length && /\s/.test(code[i] as string)) i++
  return code[i] === ',' ? i + 1 : end
}

/** Replace a range, keeping its line count so later line numbers do not shift. */
function removal(code: string, start: number, end: number, text: string): Edit {
  const newlines = code.slice(start, end).split('\n').length - 1
  return { start, end, text: text + '\n'.repeat(newlines) }
}

function applyEdits(code: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start || b.end - a.end)
  let out = ''
  let cursor = 0
  for (const edit of sorted) {
    if (edit.start < cursor) continue // nested inside an edit already applied
    out += code.slice(cursor, edit.start) + edit.text
    cursor = edit.end
  }
  return out + code.slice(cursor)
}

type Visitor = (node: Node, ancestors: Node[]) => 'skip' | undefined

function walk(node: Node, visit: Visitor, ancestors: Node[] = []) {
  if (visit(node, ancestors) === 'skip') return
  ancestors.push(node)
  for (const key in node) {
    if (key === 'type' || key === 'start' || key === 'end') continue
    const value = node[key]
    if (Array.isArray(value)) {
      for (const child of value) if (isNode(child)) walk(child, visit, ancestors)
    } else if (isNode(value)) {
      walk(value, visit, ancestors)
    }
  }
  ancestors.pop()
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as Node).type === 'string'
}

// ---------------------------------------------------------------------------
// Dead-code elimination (client only)
// ---------------------------------------------------------------------------

interface Reference {
  name: string
  start: number
}

/** Every identifier that *reads* a binding (declarations and property names excluded). */
export function collectReferences(ast: Node): Reference[] {
  const refs: Reference[] = []

  const visit = (node: Node | null | undefined, binding: boolean): void => {
    if (!node) return
    switch (node.type) {
      case 'Identifier':
        if (!binding) refs.push({ name: node.name, start: node.start })
        return
      case 'MemberExpression':
        visit(node.object, false)
        if (node.computed) visit(node.property, false)
        return
      case 'Property':
        if (node.computed) visit(node.key, false)
        visit(node.value, binding)
        return
      case 'MethodDefinition':
      case 'PropertyDefinition':
      case 'AccessorProperty':
        if (node.computed) visit(node.key, false)
        visit(node.value, false)
        return
      case 'VariableDeclarator':
        visit(node.id, true)
        visit(node.init, false)
        return
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        for (const param of node.params) visit(param, true)
        visit(node.body, false)
        return
      case 'ClassDeclaration':
      case 'ClassExpression':
        visit(node.superClass, false)
        visit(node.body, false)
        return
      case 'AssignmentPattern':
        visit(node.left, binding)
        visit(node.right, false)
        return
      case 'RestElement':
        visit(node.argument, binding)
        return
      case 'ArrayPattern':
        for (const element of node.elements) visit(element, binding)
        return
      case 'ObjectPattern':
        for (const property of node.properties) visit(property, binding)
        return
      case 'CatchClause':
        visit(node.param, true)
        visit(node.body, false)
        return
      case 'ImportDeclaration':
        return
      case 'ExportNamedDeclaration':
        if (node.source) return // re-export from another module
        visit(node.declaration, false)
        for (const spec of node.specifiers) visit(spec.local, false)
        return
      case 'LabeledStatement':
        visit(node.body, false)
        return
      case 'BreakStatement':
      case 'ContinueStatement':
      case 'MetaProperty':
        return
      default:
        for (const key in node) {
          if (key === 'type' || key === 'start' || key === 'end') continue
          const value = node[key]
          if (Array.isArray(value)) {
            for (const child of value) if (isNode(child)) visit(child, false)
          } else if (isNode(value)) {
            visit(value, false)
          }
        }
    }
  }

  visit(ast, false)
  return refs
}

function declaredNames(stmt: Node): string[] | null {
  if (stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration') {
    return stmt.id ? [stmt.id.name] : null
  }
  if (stmt.type === 'VariableDeclaration') {
    const names: string[] = []
    for (const declarator of stmt.declarations as Node[]) {
      if (declarator.id.type !== 'Identifier') return null
      names.push(declarator.id.name)
    }
    return names
  }
  return null // exports and everything else are kept
}

function eliminateDeadCode(
  ast: Node,
  code: string,
  removed: Array<[number, number]>,
  edits: Edit[],
) {
  const refs = collectReferences(ast)
  const isRemoved = (pos: number) => removed.some(([s, e]) => pos >= s && pos < e)
  const liveRefs = (name: string) => refs.some((r) => r.name === name && !isRemoved(r.start))

  // Only bindings that the removed code used are candidates for removal.
  const candidates = new Set(refs.filter((r) => isRemoved(r.start)).map((r) => r.name))
  const body = ast.body as Node[]

  let changed = true
  while (changed) {
    changed = false
    for (const stmt of body) {
      if (isRemoved(stmt.start)) continue
      const names = declaredNames(stmt)
      if (!names?.some((n) => candidates.has(n)) || names.some(liveRefs)) continue
      edits.push(removal(code, stmt.start, stmt.end, ''))
      removed.push([stmt.start, stmt.end])
      for (const ref of refs) {
        if (ref.start >= stmt.start && ref.start < stmt.end) candidates.add(ref.name)
      }
      changed = true
    }
  }

  for (const stmt of body) {
    if (stmt.type !== 'ImportDeclaration' || stmt.specifiers.length === 0) continue
    const specifiers = stmt.specifiers as Node[]
    const kept = specifiers.filter(
      (s) => !(candidates.has(s.local.name) && !liveRefs(s.local.name)),
    )
    if (kept.length === specifiers.length) continue
    edits.push(removal(code, stmt.start, stmt.end, kept.length ? printImport(stmt, kept) : ''))
  }
}

function printImport(stmt: Node, specifiers: Node[]): string {
  const parts: string[] = []
  const named: string[] = []
  for (const spec of specifiers) {
    if (spec.type === 'ImportDefaultSpecifier') parts.unshift(spec.local.name)
    else if (spec.type === 'ImportNamespaceSpecifier') parts.push(`* as ${spec.local.name}`)
    else {
      const imported =
        spec.imported.type === 'Identifier' ? spec.imported.name : JSON.stringify(spec.imported.value)
      named.push(imported === spec.local.name ? imported : `${imported} as ${spec.local.name}`)
    }
  }
  if (named.length) parts.push(`{ ${named.join(', ')} }`)
  return `import ${parts.join(', ')} from ${JSON.stringify(stmt.source.value)};`
}
