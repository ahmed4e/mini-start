/**
 * The project builder: a small local web server and a single-page UI.
 *
 * The server can write files and run installs, so it only listens on
 * localhost and every API call must carry a random per-run token. The token
 * is in the URL the CLI prints and opens. Host and Origin checks block DNS
 * rebinding and cross-site requests from other pages in the browser.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createProject } from './create.ts'
import { detectEnvironment, type Environment, invokingPackageManager, openBrowser, openInEditor } from './env.ts'
import { planProject, toolVersion } from './generate.ts'
import {
  ADD_ONS,
  DEFAULT_ADD_ONS,
  DEFAULT_FRAMEWORK,
  DEFAULT_NAME,
  DEFAULT_PATTERN,
  type FrameworkId,
  FRAMEWORKS,
  normalizeOptions,
  type PackageManager,
  type PatternId,
  PATTERNS,
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
    addOns?: string[]
    install?: boolean
    git?: boolean
  }
}

const MAX_BODY = 64 * 1024

export async function startUi(opts: UiOptions): Promise<void> {
  const token = randomBytes(18).toString('base64url')
  const page = fs.readFileSync(new URL('./ui/index.html', import.meta.url), 'utf8')
  const environment = detectEnvironment()
  const created = new Set<string>()
  let busy = false

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) sendJson(res, 500, { error: (error as Error).message })
      else res.end()
    })
  })

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const port = (server.address() as AddressInfo).port
    const hosts = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]
    if (!hosts.includes(req.headers.host ?? '')) return send(res, 403, 'text/plain', 'Unknown host')
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

    if (req.method === 'GET' && url.pathname === '/') {
      if (!tokenMatches(url.searchParams.get('token'), token)) {
        return send(res, 403, 'text/html; charset=utf-8', FORBIDDEN_PAGE)
      }
      return send(res, 200, 'text/html; charset=utf-8', page.replace('__CREATE_TOKEN__', token), {
        'content-security-policy':
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      })
    }
    if (req.method === 'GET' && url.pathname === '/favicon.svg') {
      return send(res, 200, 'image/svg+xml', faviconSvg())
    }
    if (!url.pathname.startsWith('/api/')) return send(res, 404, 'text/plain', 'Not found')

    const origin = req.headers.origin
    if (origin && !hosts.some((host) => origin === `http://${host}`)) {
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
      return sendJson(res, 200, { target: targetDir(options), errors, files })
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

  function info(env: Environment) {
    const available = env.packageManagers.map((pm) => pm.id)
    const preferred = [opts.initial?.packageManager, invokingPackageManager(), 'pnpm', 'npm']
    const packageManager =
      preferred.find((pm) => pm && available.includes(pm)) ?? available[0] ?? opts.initial?.packageManager ?? 'npm'
    return {
      version: toolVersion(),
      cwd: opts.cwd,
      command: opts.command,
      frameworks: FRAMEWORKS,
      patterns: PATTERNS,
      addOns: ADD_ONS,
      packageManagers: env.packageManagers,
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
  \x1b[1mcreate-mini-start\x1b[0m v${toolVersion()}

  ➜  Project builder: \x1b[36m${url}\x1b[0m
     ${opts.open ? 'Opening it in your browser. ' : ''}Press Ctrl+C to quit.
`)
  if (opts.open) openBrowser(url)

  await new Promise<void>((resolve) => server.on('close', resolve))
  console.log('  Project builder closed.')
}

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
