/**
 * Talking to src/ui-server.ts. Every request carries the per-run token the
 * server put in the page's <meta name="create-token">.
 */
import type { CreateEvent } from '../../create.ts'
import { showToast } from './toast.ts'

const TOKEN = document.querySelector('meta[name="create-token"]')?.getAttribute('content') ?? ''

/** The server stopped answering; the user has already been told. */
export class OfflineError extends Error {
  constructor() {
    super('offline')
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly data: Record<string, unknown>
  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message)
    this.status = status
    this.data = data
  }
}

export async function api(path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-create-token': TOKEN, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    showToast('Lost the connection to create-mini-start. Is it still running in your terminal?')
    throw new OfflineError()
  }
}

export async function apiJson<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await api(path, body, signal)
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new ApiError(typeof data.error === 'string' ? data.error : `Request failed (${res.status})`, res.status, data)
  return data as T
}

/** Shows an error as a toast, unless it's a cancelled request or the server is gone (already reported). */
export function reportError(error: unknown) {
  if (error instanceof OfflineError || (error instanceof DOMException && error.name === 'AbortError')) return
  showToast(error instanceof Error ? error.message : String(error))
}

/** Reads POST /api/create's newline-delimited JSON stream, one event at a time. */
export async function readEvents(res: Response, onEvent: (event: CreateEvent) => void): Promise<void> {
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line.trim()) onEvent(JSON.parse(line) as CreateEvent)
    }
  }
}
