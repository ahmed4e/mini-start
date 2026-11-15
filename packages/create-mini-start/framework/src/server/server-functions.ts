/**
 * Handles POST/GET /_serverFn/<id>: decode the payload, run the registered
 * function, encode the result (or redirect / notFound / error).
 */
import { isNotFound, isRedirect } from '../router/errors.ts'
import { SERVER_FN_HEADER, SERVER_FN_RESULT_HEADER } from '../server-fn/constants.ts'
import { getServerFnEntry, isValidationError } from '../server-fn/registry.ts'
import { decode, encode } from '../ssr/serializer.ts'

function envelope(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      [SERVER_FN_RESULT_HEADER]: '1',
    },
  })
}

function failure(message: string, status: number, includeStack = false) {
  return envelope({ ok: false, error: encode(new Error(message), { includeStack }) }, status)
}

export async function handleServerFnRequest(
  request: Request,
  id: string,
  options: { loadServerFn: (id: string) => Promise<void>; dev?: boolean },
): Promise<Response> {
  if (request.headers.get(SERVER_FN_HEADER) !== '1') {
    return failure('Missing server function header', 403)
  }

  await options.loadServerFn(id)
  const entry = getServerFnEntry(id)
  if (!entry) return failure(`Unknown server function "${id}"`, 404)
  if (request.method !== entry.method) {
    return failure(`This server function expects ${entry.method}`, 405)
  }

  let input: unknown
  try {
    const raw =
      request.method === 'GET'
        ? new URL(request.url).searchParams.get('payload')
        : await request.text()
    input = raw ? decode(JSON.parse(raw)) : undefined
  } catch {
    return failure('Invalid server function payload', 400)
  }

  try {
    const result = await entry.run(input, request)
    if (result instanceof Response) return result
    return envelope({ ok: true, value: encode(result) })
  } catch (error) {
    if (isRedirect(error)) return envelope({ redirect: error.options })
    if (isNotFound(error)) return envelope({ notFound: error.message })
    const invalidInput = isValidationError(error)
    if (!invalidInput) console.error(`[mini-start] Server function "${id}" failed:`, error)
    return envelope(
      {
        ok: false,
        error: encode(error instanceof Error ? error : new Error(String(error)), {
          includeStack: options.dev && !invalidInput,
        }),
      },
      invalidInput ? 400 : 500,
    )
  }
}
