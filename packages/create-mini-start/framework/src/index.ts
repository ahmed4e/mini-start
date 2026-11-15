/**
 * mini-start — public API.
 *
 * Everything an app imports comes from here. Server-only pieces live in
 * `mini-start/server` and `mini-start/node`; the build integration lives in
 * `mini-start/vite`.
 */

// ---------------------------------------------------------------------------
// Type registries. The generated `routeTree.gen.ts` augments these with
// `declare module 'mini-start' { ... }`, which is what makes <Link to>,
// params and search type-safe without passing a router type around.
// They must be declared in this module (not re-exported) for augmentation
// to merge with them.
// ---------------------------------------------------------------------------

/** Route id -> metadata. Filled in by the route generator. */
export interface FileRoutesByPath {}

/** Navigable path (what you pass to `to`) -> route type. Filled in by the route generator. */
export interface RegisteredRoutes {}

/** Augment this to type the `context` object passed to `beforeLoad` and `loader`. */
export interface RouterContext {}

export type {
  ParamsOf,
  RegisteredPath,
  SearchOf,
  ToOptions,
  NavigateOptions,
} from './types.ts'

export {
  Route,
  createRootRoute,
  createFileRoute,
} from './router/route.ts'
export type {
  AnyRoute,
  RouteOptions,
  LoaderContext,
  HeadConfig,
  ServerHandlers,
  ErrorComponentProps,
} from './router/route.ts'

export { Router, createRouter } from './router/router.ts'
export type {
  RouterOptions,
  RouterState,
  Match,
  ParsedLocation,
  Assets,
} from './router/router.ts'

export { createBrowserHistory, createMemoryHistory } from './router/history.ts'
export type { RouterHistory, HistoryLocation } from './router/history.ts'

export {
  redirect,
  notFound,
  isRedirect,
  isNotFound,
  Redirect,
  NotFound,
} from './router/errors.ts'

export { RouterProvider, Outlet } from './react/RouterProvider.tsx'
export { Link } from './react/Link.tsx'
export type { LinkProps } from './react/Link.tsx'
export {
  useRouter,
  useRouterState,
  useNavigate,
  useLocation,
  useParams,
  useSearch,
  useMatches,
} from './react/hooks.ts'
export { Await } from './react/Await.tsx'
export { HeadContent, Scripts } from './react/Document.tsx'

export { createServerFn, useServerFn } from './server-fn/createServerFn.ts'
export type { ServerFn, ServerFnContext } from './server-fn/createServerFn.ts'
