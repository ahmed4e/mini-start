/**
 * Type-level helpers that turn route path strings into typed params and
 * restrict navigation targets to routes that actually exist.
 *
 * TanStack Router does the same thing with template-literal types driven by a
 * generated route tree; this is a deliberately small version of that idea.
 */
import type { RegisteredRoutes } from './index.ts'

/** Split '/posts/$postId/edit' into 'posts' | '$postId' | 'edit'. */
type Segments<P extends string> = P extends `${infer Head}/${infer Tail}`
  ? Head | Segments<Tail>
  : P

/** '$postId' -> 'postId', '$' (splat) -> '_splat', anything else -> never. */
type ParamName<S extends string> = S extends `$${infer Name}`
  ? Name extends ''
    ? '_splat'
    : Name
  : never

/** `ParamsOf<'/posts/$postId'>` is `{ postId: string }`. */
export type ParamsOf<P extends string> = {
  [K in ParamName<Segments<P>>]: string
}

type HasParams<P extends string> = [ParamName<Segments<P>>] extends [never]
  ? false
  : true

/**
 * Every path you can navigate to. Falls back to `string` until the route
 * generator has run, so a fresh project still type-checks.
 */
export type RegisteredPath = keyof RegisteredRoutes extends never
  ? string
  : Extract<keyof RegisteredRoutes, string>

/** The validated search-param type of a navigable path. */
export type SearchOf<TTo extends string> = TTo extends keyof RegisteredRoutes
  ? RegisteredRoutes[TTo] extends { types: { search: infer S } }
    ? S
    : Record<string, unknown>
  : Record<string, unknown>

type ParamsOption<TTo extends string> = string extends TTo
  ? { params?: Record<string, string> }
  : HasParams<TTo> extends true
    ? { params: ParamsOf<TTo> }
    : { params?: undefined }

/** Where to go: a known path, its params (required when the path has any) and search. */
export type ToOptions<TTo extends string = RegisteredPath> = {
  to: TTo
  search?: Partial<SearchOf<TTo>>
  hash?: string
} & ParamsOption<TTo>

export type NavigateOptions<TTo extends string = RegisteredPath> =
  ToOptions<TTo> & {
    replace?: boolean
  }
