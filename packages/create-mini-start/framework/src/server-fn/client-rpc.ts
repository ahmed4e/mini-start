/**
 * The client-side stand-in for a server function. In the browser bundle the
 * compiler replaces `createServerFn().handler(<server code>)` with
 * `.handler(createClientRpc("<id>"))`, so the server code never ships.
 */
import { notFound, Redirect, type RedirectOptions } from '../router/errors.ts'
import { decode, encode } from '../ssr/serializer.ts'
import {
  DEFAULT_SERVER_FN_BASE,
  RPC_MARKER,
  SERVER_FN_HEADER,
  SERVER_FN_RESULT_HEADER,
} from './constants.ts'

export interface ClientRpc {
  [RPC_MARKER]: true
  id: string
  url: string
  call(
    method: 'GET' | 'POST',
    data: unknown,
    signal?: AbortSignal,
  ): Promise<unknown>
}

interface Envelope {
  ok?: boolean
  value?: unknown
  error?: unknown
  redirect?: RedirectOptions
  notFound?: string
}

export function createClientRpc(
  id: string,
  base: string = DEFAULT_SERVER_FN_BASE,
): ClientRpc {
  const url = base + encodeURIComponent(id)
  return {
    [RPC_MARKER]: true,
    id,
    url,
    async call(method, data, signal) {
      const headers: Record<string, string> = {
        [SERVER_FN_HEADER]: '1',
        accept: 'application/json',
      }
      let response: Response
      if (method === 'GET') {
        const query =
          data === undefined
            ? ''
            : `?payload=${encodeURIComponent(JSON.stringify(encode(data)))}`
        response = await fetch(url + query, { headers, signal })
      } else {
        headers['content-type'] = 'application/json'
        response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(encode(data)),
          signal,
        })
      }

      // The handler returned its own Response: hand it to the caller untouched.
      if (response.headers.get(SERVER_FN_RESULT_HEADER) !== '1') return response

      const body = (await response.json()) as Envelope
      if (body.redirect) throw new Redirect(body.redirect)
      if (body.notFound !== undefined) throw notFound(body.notFound)
      if (!body.ok) throw decode(body.error)
      return decode(body.value)
    },
  }
}

export function isClientRpc(value: unknown): value is ClientRpc {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<ClientRpc>)[RPC_MARKER] === true
  )
}
