/**
 * Server-side registry of compiled server functions, keyed by function id.
 *
 * Kept on `globalThis` so every copy of this module (the dev module runner
 * can evaluate a module more than once across reloads) shares one table.
 */
export interface ServerFnEntry {
  method: 'GET' | 'POST'
  run: (input: unknown, request?: Request) => Promise<unknown>
}

type Registry = Map<string, ServerFnEntry>

const globalRef = globalThis as typeof globalThis & {
  __MINI_START_FN_REGISTRY__?: Registry
  __MINI_START_REQUEST_STORE__?: { getStore(): Request | undefined }
}

const registry: Registry = (globalRef.__MINI_START_FN_REGISTRY__ ??= new Map())

export function registerServerFn(id: string, entry: ServerFnEntry): void {
  registry.set(id, entry)
}

export function getServerFnEntry(id: string): ServerFnEntry | undefined {
  return registry.get(id)
}

/** Errors thrown by a validator are reported to the client with status 400 instead of 500. */
export function markValidationError(error: unknown): Error {
  const wrapped = error instanceof Error ? error : new Error(String(error))
  ;(wrapped as Error & { isValidationError?: boolean }).isValidationError = true
  return wrapped
}

export function isValidationError(error: unknown): boolean {
  return (error as { isValidationError?: boolean } | null)?.isValidationError === true
}

/** The request being handled right now (set by the server handler via AsyncLocalStorage). */
export function getCurrentRequest(): Request | undefined {
  return globalRef.__MINI_START_REQUEST_STORE__?.getStore()
}
