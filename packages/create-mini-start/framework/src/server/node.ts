/**
 * Node.js adapter: IncomingMessage <-> Request/Response, plus the production
 * server (static files from dist/client, everything else through the handler).
 */
import { once } from 'node:events'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { StartHandler } from './handler.ts'

export function toWebRequest(req: IncomingMessage, res?: ServerResponse): Request {
  const original = (req as IncomingMessage & { originalUrl?: string }).originalUrl
  const host = req.headers.host ?? 'localhost'
  const protocol = (req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http'
  const url = new URL(original ?? req.url ?? '/', `${protocol}://${host}`)

  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v)
    else if (value !== undefined) headers.set(key, value)
  }

  const controller = new AbortController()
  res?.on('close', () => {
    if (!res.writableFinished) controller.abort()
  })

  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers,
    signal: controller.signal,
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = Readable.toWeb(req) as unknown as ReadableStream
    init.duplex = 'half'
  }
  return new Request(url, init)
}

export async function sendWebResponse(
  res: ServerResponse,
  response: Response,
): Promise<void> {
  res.statusCode = response.status
  const cookies = response.headers.getSetCookie()
  for (const [key, value] of response.headers) {
    if (key !== 'set-cookie') res.setHeader(key, value)
  }
  if (cookies.length) res.setHeader('set-cookie', cookies)

  if (!response.body) {
    res.end()
    return
  }
  const reader = response.body.getReader()
  const onClose = () => void reader.cancel().catch(() => {})
  res.on('close', onClose)
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!res.write(value)) await once(res, 'drain')
    }
  } finally {
    res.off('close', onClose)
    res.end()
  }
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  clientDir: string,
): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  } catch {
    return false
  }
  if (pathname === '/' || pathname.includes('\0')) return false

  const filePath = path.join(clientDir, path.normalize(pathname))
  // Never serve outside dist/client, or Vite's build manifest.
  if (!filePath.startsWith(clientDir + path.sep) || filePath.includes(`${path.sep}.vite${path.sep}`)) {
    return false
  }
  const info = await stat(filePath).catch(() => null)
  if (!info?.isFile()) return false

  res.statusCode = 200
  res.setHeader(
    'content-type',
    MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
  )
  res.setHeader('content-length', info.size)
  res.setHeader(
    'cache-control',
    pathname.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable' // content-hashed file names
      : 'public, max-age=0, must-revalidate',
  )
  if (req.method === 'HEAD') {
    res.end()
    return true
  }
  createReadStream(filePath).pipe(res)
  return true
}

export function startNodeServer(options: {
  handler: StartHandler
  clientDir: string
  port?: number
  host?: string
}): http.Server {
  const port = options.port ?? Number(process.env.PORT ?? 3000)
  const host = options.host ?? process.env.HOST
  const clientDir = path.resolve(options.clientDir)

  const server = http.createServer(async (req, res) => {
    try {
      if (await serveStatic(req, res, clientDir)) return
      await sendWebResponse(res, await options.handler.fetch(toWebRequest(req, res)))
    } catch (error) {
      console.error(error)
      if (!res.headersSent) {
        res.statusCode = 500
        res.end('Internal Server Error')
      } else {
        res.end()
      }
    }
  })
  server.listen(port, host, () => {
    console.log(`mini-start server listening on http://localhost:${port}`)
  })
  return server
}
