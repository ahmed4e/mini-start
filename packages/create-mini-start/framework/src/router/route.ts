/**
 * Route objects. Each file in `src/routes` exports `Route`, created with
 * `createFileRoute(id)(options)` (or `createRootRoute` for `__root.tsx`).
 *
 * A route starts out "detached": the generated `routeTree.gen.ts` wires it
 * into the tree via `_init` / `_addChildren`, exactly like TanStack's
 * generated `.update({ id, path, getParentRoute })` calls.
 */
import type { ComponentType } from 'react'
import type { FileRoutesByPath, RouterContext } from '../index.ts'
import { useRouterState } from '../react/hooks.ts'
import type { ParamsOf } from '../types.ts'
import { parseRoutePath, type Segment } from './path.ts'
import type { ParsedLocation, Router } from './router.ts'

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'

export interface ServerHandlerContext<TId extends string> {
  request: Request
  params: ParamsOf<TId>
}

export type ServerHandler<TId extends string> = (
  ctx: ServerHandlerContext<TId>,
) => Response | Promise<Response>

/** API-route handlers, keyed by HTTP method (`ANY` matches every method). */
export type ServerHandlers<TId extends string = string> = Partial<
  Record<HttpMethod | 'ANY', ServerHandler<TId>>
>

export interface LoaderContext<
  TId extends string = string,
  TSearch = Record<string, unknown>,
> {
  params: ParamsOf<TId>
  search: TSearch
  context: RouterContext & Record<string, unknown>
  location: ParsedLocation
  abortController: AbortController
  cause: 'enter' | 'preload' | 'invalidate'
}

export type BeforeLoadContext<
  TId extends string = string,
  TSearch = Record<string, unknown>,
> = Omit<LoaderContext<TId, TSearch>, 'abortController'>

/**
 * Tags rendered by <HeadContent />. `meta` entries are attribute objects:
 * `{ title: '...' }`, `{ name: 'description', content: '...' }`,
 * `{ property: 'og:title', content: '...' }`, `{ charSet: 'utf-8' }`.
 * Deeper routes override shallower ones.
 */
export type HeadTag = Record<string, string | undefined>

export interface HeadConfig {
  meta?: HeadTag[]
  links?: HeadTag[]
}

export interface ErrorComponentProps {
  error: Error
  reset: () => void
}

export interface RouteOptions<
  TId extends string = string,
  TLoaderData = unknown,
  TSearch = Record<string, unknown>,
> {
  /** Validate and type the URL search params; the result is what `useSearch` returns. */
  validateSearch?: (raw: Record<string, unknown>) => TSearch
  /** Runs sequentially root -> leaf before loaders. Return an object to extend `context`. */
  beforeLoad?: (
    ctx: BeforeLoadContext<TId, TSearch>,
  ) =>
    | void
    | Record<string, unknown>
    | Promise<void | Record<string, unknown>>
  /** Runs in parallel for all matched routes, on the server for the first request and on the client afterwards. */
  loader?: (
    ctx: LoaderContext<TId, TSearch>,
  ) => TLoaderData | Promise<TLoaderData>
  head?: (ctx: { loaderData: TLoaderData; params: ParamsOf<TId> }) => HeadConfig
  component?: ComponentType
  errorComponent?: ComponentType<ErrorComponentProps>
  notFoundComponent?: ComponentType
  /** Server-only request handlers (API routes). Stripped from the client bundle by the compiler. */
  server?: { handlers: ServerHandlers<TId> }
}

export type AnyRoute = Route<any, any, any>

export class Route<
  TId extends string = string,
  TLoaderData = unknown,
  TSearch = Record<string, unknown>,
> {
  /** Phantom type carrier used by type-level helpers (never set at runtime). */
  declare readonly types: { id: TId; loaderData: TLoaderData; search: TSearch }

  options: RouteOptions<TId, TLoaderData, TSearch>
  id: string
  /** Path relative to the parent route ('' for pathless layouts). */
  path = ''
  fullPath = '/'
  segments: Segment[] = []
  parent: AnyRoute | undefined = undefined
  children: AnyRoute[] = []
  isRoot: boolean
  isIndex = false
  isPathless = false
  /** True for routes that only define `server.handlers` (no UI). */
  serverOnly = false
  router: Router | undefined = undefined

  constructor(
    options: RouteOptions<TId, TLoaderData, TSearch>,
    init: { id: string; isRoot?: boolean },
  ) {
    this.options = options
    this.id = init.id
    this.isRoot = !!init.isRoot
  }

  /** Called by the generated route tree. */
  _init(opts: {
    id: string
    path: string
    fullPath: string
    parent: AnyRoute
    isIndex?: boolean
    serverOnly?: boolean
  }): this {
    this.id = opts.id
    this.path = opts.path
    this.fullPath = opts.fullPath
    this.parent = opts.parent
    this.isIndex = !!opts.isIndex
    this.isPathless = !opts.isIndex && opts.path === ''
    this.serverOnly = !!opts.serverOnly
    this.segments = this.isIndex ? [] : parseRoutePath(opts.path)
    return this
  }

  /** Called by the generated route tree. */
  _addChildren(children: AnyRoute[]): this {
    this.children = children
    for (const child of children) child.parent = this
    return this
  }

  /** Dev-only: swap in a freshly generated route tree after a route file changed (HMR). */
  _hotReplace(nextTree: AnyRoute): void {
    this.router?.setRouteTree(nextTree)
  }

  useLoaderData = (): TLoaderData =>
    useRouterState(
      (s) => s.matches.find((m) => m.routeId === this.id)?.loaderData,
    ) as TLoaderData

  useParams = (): ParamsOf<TId> =>
    useRouterState(
      (s) => s.matches.find((m) => m.routeId === this.id)?.params ?? {},
    ) as ParamsOf<TId>

  useSearch = (): TSearch =>
    useRouterState(
      (s) => s.matches.find((m) => m.routeId === this.id)?.search ?? {},
    ) as TSearch
}

export function createRootRoute<TLoaderData = undefined>(
  options: RouteOptions<'/', TLoaderData> = {},
): Route<'/', TLoaderData> {
  const route = new Route<'/', TLoaderData>(options, {
    id: '__root__',
    isRoot: true,
  })
  route.path = '/'
  route.fullPath = '/'
  return route
}

type FileRouteId = keyof FileRoutesByPath extends never
  ? string
  : Extract<keyof FileRoutesByPath, string>

/**
 * `export const Route = createFileRoute('/posts/$postId')({ loader, component })`
 *
 * The id string must match the file's location; the route generator rewrites
 * it automatically when a file is created or moved.
 */
export function createFileRoute<TId extends FileRouteId>(id: TId) {
  return <TLoaderData = undefined, TSearch = Record<string, unknown>>(
    options: RouteOptions<TId, TLoaderData, TSearch>,
  ): Route<TId, TLoaderData, TSearch> => new Route(options, { id })
}
