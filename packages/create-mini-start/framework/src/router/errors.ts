/**
 * Control-flow "errors" thrown from `beforeLoad`, loaders and server
 * functions. The router (client), the request handler (server) and the RPC
 * layer all recognise them and react without treating them as failures.
 */
import type { NavigateOptions, RegisteredPath } from '../types.ts'

export type RedirectOptions =
  | (NavigateOptions<string> & { statusCode?: number; href?: undefined })
  | { href: string; statusCode?: number; replace?: boolean; to?: undefined }

export class Redirect {
  readonly isRedirect = true
  readonly options: RedirectOptions
  constructor(options: RedirectOptions) {
    this.options = options
  }
}

export class NotFound {
  readonly isNotFound = true
  readonly message: string
  constructor(message = 'Not Found') {
    this.message = message
  }
}

/** `throw redirect({ to: '/login' })` from a loader, beforeLoad or server function. */
export function redirect<TTo extends RegisteredPath>(
  options:
    | (NavigateOptions<TTo> & { statusCode?: number })
    | { href: string; statusCode?: number; replace?: boolean },
): Redirect {
  return new Redirect(options as RedirectOptions)
}

/** `throw notFound()` renders the nearest `notFoundComponent` with a 404 status. */
export function notFound(message?: string): NotFound {
  return new NotFound(message)
}

export function isRedirect(value: unknown): value is Redirect {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Redirect).isRedirect === true
  )
}

export function isNotFound(value: unknown): value is NotFound {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as NotFound).isNotFound === true
  )
}
