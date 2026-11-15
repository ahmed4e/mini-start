import { AsyncLocalStorage } from 'node:async_hooks'

const store = new AsyncLocalStorage<Request>()
// Shared with server-fn/registry.ts without importing node built-ins into isomorphic code.
;(globalThis as { __MINI_START_REQUEST_STORE__?: unknown }).__MINI_START_REQUEST_STORE__ =
  store

export function runWithRequest<T>(request: Request, fn: () => T): T {
  return store.run(request, fn)
}

/** The incoming request, from anywhere inside a loader, server function or API route on the server. */
export function getRequest(): Request {
  const request = store.getStore()
  if (!request) throw new Error('getRequest() was called outside of a request')
  return request
}
