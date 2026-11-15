/**
 * The whole server is one Web-standard function: `fetch(Request) => Response`.
 * The Vite dev middleware and the production Node server both call it.
 *
 * Dispatch order (same as TanStack Start's createStartHandler):
 *   1. /_serverFn/<id>              -> server function RPC
 *   2. route with server.handlers   -> API route
 *   3. everything else              -> load the router and stream SSR HTML
 */
import { isNotFound, isRedirect, type Redirect } from '../router/errors.ts'
import { createMemoryHistory } from '../router/history.ts'
import type { HttpMethod, ServerHandlers } from '../router/route.ts'
import type { Assets, Router } from '../router/router.ts'
import { DEFAULT_SERVER_FN_BASE } from '../server-fn/constants.ts'
import { renderToResponse } from '../ssr/render.tsx'
import { SsrStream } from '../ssr/stream.ts'
import { runWithRequest } from './request-store.ts'
import { handleServerFnRequest } from './server-functions.ts'

export interface StartHandlerOptions {
  /** Creates a fresh router (called once per request). */
  getRouter: () => Router
  getAssets: () => Assets | Promise<Assets>
  /** Make sure the module defining a server function has been evaluated. */
  loadServerFn: (id: string) => Promise<void>
  serverFnBase?: string
  dev?: boolean
}

export interface StartHandler {
  fetch(request: Request): Promise<Response>
}

export function createStartHandler(options: StartHandlerOptions): StartHandler {
  const base = options.serverFnBase ?? DEFAULT_SERVER_FN_BASE

  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)

    // 1. Server functions
    if (url.pathname.startsWith(base)) {
      const id = decodeURIComponent(url.pathname.slice(base.length))
      return handleServerFnRequest(request, id, options)
    }

    const router = options.getRouter()
    router.history = createMemoryHistory(url.pathname + url.search + url.hash)
    const method = request.method.toUpperCase()

    // 2. API routes
    const branch = router.matchRoutes(url.pathname)
    const leaf = branch?.routes.at(-1)
    const handlers = leaf?.options.server?.handlers as ServerHandlers | undefined
    if (branch && leaf && handlers) {
      const handler =
        handlers[method as HttpMethod] ??
        (method === 'HEAD' ? handlers.GET : undefined) ??
        handlers.ANY
      if (handler) {
        try {
          return await handler({ request, params: branch.params as never })
        } catch (error) {
          if (isRedirect(error)) return redirectResponse(router, error)
          if (isNotFound(error)) return new Response('Not Found', { status: 404 })
          throw error
        }
      }
      if (!leaf.options.component) {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: { allow: Object.keys(handlers).join(', ') },
        })
      }
    }

    if (method !== 'GET' && method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 })
    }
    if (!branch && !acceptsHtml(request)) {
      return new Response('Not Found', { status: 404 })
    }

    // 3. SSR
    await router.load()
    if (router.state.redirect) return redirectResponse(router, router.state.redirect)

    const assets = await options.getAssets()
    const ssr = new SsrStream(router.dehydrate(assets), {
      includeStack: options.dev,
    })
    router.ssr = { assets, bootstrapScript: ssr.bootstrapScript }

    try {
      return await renderToResponse(router, ssr, router.state.statusCode)
    } catch (error) {
      console.error('[mini-start] Failed to render:', error)
      return new Response(errorPage(error, options.dev), {
        status: 500,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }
  }

  return {
    fetch: (request) => runWithRequest(request, () => handle(request)),
  }
}

function redirectResponse(router: Router, redirect: Redirect): Response {
  const target = redirect.options
  const location =
    target.href !== undefined
      ? target.href
      : router.buildLocation(target as Parameters<Router['buildLocation']>[0]).href
  return new Response(null, {
    status: target.statusCode ?? 307,
    headers: { location },
  })
}

function acceptsHtml(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '*/*'
  return accept.includes('text/html') || accept.includes('*/*')
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

function errorPage(error: unknown, dev?: boolean): string {
  const detail =
    dev && error instanceof Error
      ? `<pre>${escapeHtml(error.stack ?? error.message)}</pre>`
      : ''
  return `<!DOCTYPE html><html><head><title>Server error</title></head><body><h1>500 — Server error</h1>${detail}</body></html>`
}
