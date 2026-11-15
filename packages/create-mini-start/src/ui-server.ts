/**
 * The project builder: a small local web server and a React page (src/ui).
 *
 * The server can write files and run installs, so it only listens on
 * localhost and every API call must carry a random per-run token. The token
 * is in the URL the CLI prints and opens. Host, Origin and Sec-Fetch-Site
 * checks block DNS rebinding and requests from other sites in the browser.
 *
 * The page comes from one of two places:
 *  - source: the React code in src/ui, compiled on the fly by Vite, with hot
 *    reload. Used when the CLI runs as TypeScript from this repo.
 *  - build:  the output of `pnpm build:ui` in dist/ui. Used by a compiled
 *    (published) copy, which doesn't have Vite.
 * CREATE_MINI_START_UI=source|build overrides the choice.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProject } from './create.ts'
import { detectEnvironment, type Environment, invokingPackageManager, openBrowser, openInEditor } from './env.ts'
import { type PlannedFile, planProject, toolVersion } from './generate.ts'
import {
  type AddOn,
  type AddOnId,
  ADD_ONS,
  DEFAULT_ADD_ONS,
  DEFAULT_FRAMEWORK,
  DEFAULT_NAME,
  DEFAULT_PATTERN,
  type Framework,
  type FrameworkId,
  FRAMEWORKS,
  normalizeOptions,
  PACKAGE_MANAGERS,
  type PackageManager,
  type Pattern,
  type PatternId,
  PATTERNS,
  type ProjectOptions,
  suggestName,
  targetDir,
  validateName,
} from './options.ts'
import { faviconSvg } from './templates.ts'

export interface UiOptions {
  port: number
  open: boolean
  /** The user's terminal folder: relative locations resolve against it, and `cd` hints start from it. */
  cwd: string
  /** The location field's starting value. */
  defaultParentDir: string
  /** How the user launched the CLI, for the "same thing from the terminal" hint. */
  command: string
  /** Preselected name / framework / package manager / add-ons from CLI flags. */
  initial?: {
    name?: string
    framework?: FrameworkId
    pattern?: PatternId
    packageManager?: PackageManager
    addOns?: AddOnId[]
    install?: boolean
    git?: boolean
  }
  /** Where the page comes from; see the top of this file. */
  page?: PageMode
}

export type PageMode = 'source' | 'build'

/** GET /api/info: the catalogs, what's installed, and the form's starting values. */
export interface BuilderInfo {
  version: string
  cwd: string
  command: string
  frameworks: Framework[]
  patterns: Pattern[]
  addOns: AddOn[]
  /** Every supported package manager; `version` is null when it isn't installed. */
  packageManagers: { id: PackageManager; version: string | null }[]
  /** git's version, or null when it isn't installed. */
  git: string | null
  vscode: boolean
  defaults: ProjectOptions
}

export type FieldErrors = Partial<Record<'name' | 'parentDir', string>>

/** POST /api/preview: the files the options would produce, and any problems with name or location. */
export interface PreviewResponse {
  target: string
  errors: FieldErrors
  files: PlannedFile[]
}

const MAX_BODY = 64 * 1024
const UI_SOURCE = fileURLToPath(new URL('./ui/', import.meta.url))
const UI_BUILD = fileURLToPath(new URL('../dist/ui/', import.meta.url))

export async function startUi(opts: UiOptions): Promise<void> {
  const token = randomBytes(18).toString('base64url')
  const environment = detectEnvironment()
  const created = new Set<string>()
  let busy = false

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) sendJson(res, 500, { error: (error as Error).message })
      else res.end()
    })
  })
  const page = await loadPage(opts.page ?? defaultPageMode(), server)

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const port = (server.address() as AddressInfo).port
    const hosts = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]
    const host = req.headers.host ?? ''
    if (!hosts.includes(host)) return send(res, 403, 'text/plain', 'Unknown host')
    const url = new URL(req.url ?? '/', `http://${host}`)

    if (req.method === 'GET' && url.pathname === '/') {
      if (!tokenMatches(url.searchParams.get('token'), token)) {
        return send(res, 403, 'text/html; charset=utf-8', FORBIDDEN_PAGE)
      }
      const html = (await page.html(req.url ?? '/')).replace('__CREATE_TOKEN__', token)
      return send(res, 200, 'text/html; charset=utf-8', html, { 'content-security-policy': page.csp(host) })
    }

    // Everything else is only for the builder page itself. Browsers say where a request
    // comes from; refuse other sites, including other localhost ports.
    const site = req.headers['sec-fetch-site']
    if (site === 'cross-site' || site === 'same-site') return send(res, 403, 'text/plain', 'Cross-site request refused')

    if (req.method === 'GET' && url.pathname === '/favicon.svg') {
      return send(res, 200, 'image/svg+xml', faviconSvg())
    }
    if (!url.pathname.startsWith('/api/')) {
      if (await page.serve(req, res, url.pathname)) return
      return send(res, 404, 'text/plain', 'Not found')
    }

    const origin = req.headers.origin
    if (origin && !hosts.some((h) => origin === `http://${h}`)) {
      return sendJson(res, 403, { error: 'Cross-origin request refused' })
    }
    if (!tokenMatches(req.headers['x-create-token'], token)) {
      return sendJson(res, 403, { error: 'Missing or wrong token. Open the link printed in your terminal.' })
    }

    const route = `${req.method} ${url.pathname}`
    if (route === 'GET /api/info') return sendJson(res, 200, info(await environment))

    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' })
    const body = await readJson(req)

    if (route === 'POST /api/preview') {
      const { options, errors } = normalizeOptions(body, opts.cwd)
      // An unusable name would end up inside generated code; preview with a placeholder.
      const name = validateName(options.name) ? DEFAULT_NAME : options.name
      const files = planProject({ ...options, name })
      return sendJson(res, 200, { target: targetDir(options), errors, files } satisfies PreviewResponse)
    }

    if (route === 'POST /api/create') {
      if (busy) return sendJson(res, 409, { error: 'A project is already being created.' })
      const { options, errors } = normalizeOptions(body, opts.cwd)
      if (Object.keys(errors).length) return sendJson(res, 400, { error: 'Fix the highlighted fields.', errors })
      const env = await environment
      if (options.install && !env.packageManagers.some((pm) => pm.id === options.packageManager)) {
        return sendJson(res, 400, { error: `${options.packageManager} is not installed on this machine.` })
      }
      if (options.git && !env.git) options.git = false

      busy = true
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' })
      try {
        await createProject(
          options,
          (event) => {
            if (event.type === 'done') created.add(event.dir)
            res.write(`${JSON.stringify(event)}\n`)
          },
          opts.cwd,
        )
      } finally {
        busy = false
        res.end()
      }
      return
    }

    if (route === 'POST /api/open-editor') {
      const dir = (body as { dir?: unknown }).dir
      // Only folders this session created: the endpoint can't open arbitrary paths.
      if (typeof dir !== 'string' || !created.has(dir)) return sendJson(res, 400, { error: 'Unknown project' })
      openInEditor(dir)
      return sendJson(res, 200, { ok: true })
    }

    if (route === 'POST /api/shutdown') {
      sendJson(res, 200, { ok: true })
      setTimeout(() => {
        server.close()
        server.closeAllConnections()
      }, 50)
      return
    }

    return sendJson(res, 404, { error: 'Not found' })
  }

  function info(env: Environment): BuilderInfo {
    const installed = new Map(env.packageManagers.map((pm) => [pm.id, pm.version]))
    const preferred = [opts.initial?.packageManager, invokingPackageManager(), 'pnpm', 'npm', ...PACKAGE_MANAGERS]
    const packageManager = (preferred.find((pm) => pm && installed.has(pm)) ?? opts.initial?.packageManager ?? 'npm') as PackageManager
    return {
      version: toolVersion(),
      cwd: opts.cwd,
      command: opts.command,
      frameworks: FRAMEWORKS,
      patterns: PATTERNS,
      addOns: ADD_ONS,
      packageManagers: PACKAGE_MANAGERS.map((id) => ({ id, version: installed.get(id) ?? null })),
      git: env.git,
      vscode: env.vscode,
      defaults: {
        name: opts.initial?.name ?? suggestName(opts.defaultParentDir),
        parentDir: opts.defaultParentDir,
        framework: opts.initial?.framework ?? DEFAULT_FRAMEWORK,
        pattern: opts.initial?.pattern ?? DEFAULT_PATTERN,
        packageManager,
        addOns: opts.initial?.addOns ?? DEFAULT_ADD_ONS,
        install: opts.initial?.install ?? true,
        git: (opts.initial?.git ?? true) && env.git !== null,
      },
    }
  }

  const port = await listen(server, opts.port)
  const url = `http://localhost:${port}/?token=${token}`
  console.log(`
  \x1b[1mcreate-mini-start\x1b[0m v${toolVersion()}${page.mode === 'source' ? ' \x1b[2m(page served from source, with hot reload)\x1b[0m' : ''}

  ➜  Project builder: \x1b[36m${url}\x1b[0m
     ${opts.open ? 'Opening it in your browser. ' : ''}Press Ctrl+C to quit.
`)
  if (opts.open) openBrowser(url)

  await new Promise<void>((resolve) => server.on('close', resolve))
  await page.close()
  console.log('  Project builder closed.')
}

// ---------------------------------------------------------------- The page

function defaultPageMode(): PageMode {
  const forced = process.env.CREATE_MINI_START_UI
  if (forced === 'source' || forced === 'build') return forced
  return import.meta.url.endsWith('.ts') ? 'source' : 'build'
}

interface Page {
  mode: PageMode
  /** The page's HTML, with the token placeholder still in it. */
  html(url: string): Promise<string>
  /** Serves a script, stylesheet or other file the page loads. Resolves to false when there's no such file. */
  serve(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<boolean>
  /** Content-Security-Policy for the HTML. */
  csp(host: string): string
  close(): Promise<void>
}

const BASE_CSP = "default-src 'none'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

async function loadPage(mode: PageMode, server: http.Server): Promise<Page> {
  return mode === 'source' ? sourcePage(server) : builtPage()
}

/** The output of `pnpm build:ui`: index.html plus hashed files in assets/. */
function builtPage(): Page {
  const indexFile = path.join(UI_BUILD, 'index.html')
  if (!fs.existsSync(indexFile)) {
    throw new Error(`The project builder page isn't built (no ${indexFile}). Run "pnpm build:ui" first.`)
  }
  const html = fs.readFileSync(indexFile, 'utf8')
  const assets = path.join(UI_BUILD, 'assets')
  return {
    mode: 'build',
    html: async () => html,
    async serve(req, res, pathname) {
      if (req.method !== 'GET' || !pathname.startsWith('/assets/')) return false
      let file: string
      try {
        file = path.join(UI_BUILD, decodeURIComponent(pathname))
      } catch {
        return false
      }
      const relative = path.relative(assets, file)
      if (relative.startsWith('..') || path.isAbsolute(relative)) return false
      let body: Buffer
      try {
        body = fs.readFileSync(file)
      } catch {
        return false
      }
      res.writeHead(200, {
        'content-type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
        // File names contain a content hash.
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      })
      res.end(body)
      return true
    },
    csp: () => `${BASE_CSP}; script-src 'self'; style-src 'self'; connect-src 'self'`,
    close: async () => {},
  }
}

/** Vite in middleware mode, sharing our HTTP server for hot reload. */
async function sourcePage(server: http.Server): Promise<Page> {
  let vite: typeof import('vite')
  try {
    vite = await import('vite')
  } catch {
    throw new Error('Serving the builder page from source needs Vite. Run "pnpm install", or "pnpm build:ui" and set CREATE_MINI_START_UI=build.')
  }
  const dev = await vite.createServer({
    configFile: path.join(UI_SOURCE, 'vite.config.ts'),
    appType: 'custom',
    logLevel: 'warn',
    server: { middlewareMode: true, ws: { server } },
  })
  const indexFile = path.join(UI_SOURCE, 'index.html')
  return {
    mode: 'source',
    html: (url) => dev.transformIndexHtml(url, fs.readFileSync(indexFile, 'utf8')),
    serve: (req, res) =>
      new Promise((resolve) => {
        res.once('close', () => resolve(true))
        dev.middlewares(req, res, () => resolve(false))
      }),
    // Vite injects an inline script (React Fast Refresh) and inline styles, and talks to the page over a WebSocket.
    csp: (host) =>
      `${BASE_CSP}; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://${host}`,
    close: () => dev.close(),
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

// ---------------------------------------------------------------- Helpers

/** Listens on localhost, trying the next ports if the preferred one is taken. */
async function listen(server: http.Server, preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + 20; port++) {
    const ok = await new Promise<boolean>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off('listening', onListening)
        if (error.code === 'EADDRINUSE') resolve(false)
        else reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve(true)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, 'localhost')
    })
    if (ok) return (server.address() as AddressInfo).port
  }
  throw new Error(`No free port between ${preferred} and ${preferred + 19}. Pass --port.`)
}

function tokenMatches(value: unknown, token: string): boolean {
  if (typeof value !== 'string') return false
  const a = Buffer.from(value)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('Request body too large'))
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        reject(new Error('Invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function send(res: http.ServerResponse, status: number, type: string, body: string, headers: Record<string, string> = {}) {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  })
  res.end(body)
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(body))
}

const FORBIDDEN_PAGE = `<!doctype html><meta charset="utf-8"><title>create-mini-start</title>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5">
<h1 style="font-size:1.3rem">Open the link from your terminal</h1>
<p>This project builder only answers the address printed by <code>create-mini-start --ui</code>,
which includes a one-time token. Copy it from the terminal and open it here.</p></body>`
