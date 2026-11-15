/**
 * The router core: URL -> matched route branch -> loaded data -> state.
 *
 * Mirrors TanStack Router's model in miniature:
 *   1. match the pathname against the route tree (most specific branch wins)
 *   2. validate search params per route
 *   3. run `beforeLoad` sequentially (root -> leaf), accumulating context
 *   4. run every `loader` in parallel
 *   5. turn redirect / notFound / errors into state the UI can render
 *
 * The same class runs on the server (one instance per request, memory
 * history) and in the browser (browser history, subscribed to navigation).
 */
import type { ComponentType } from 'react'
import type { RouterContext } from '../index.ts'
import type { NavigateOptions, RegisteredPath } from '../types.ts'
import { isNotFound, isRedirect, type Redirect } from './errors.ts'
import {
  createBrowserHistory,
  createMemoryHistory,
  type HistoryAction,
  type HistoryLocation,
  type RouterHistory,
} from './history.ts'
import {
  interpolatePath,
  parseSearch,
  safeDecode,
  splitPathname,
  stringifySearch,
} from './path.ts'
import type { AnyRoute, ErrorComponentProps } from './route.ts'

export interface ParsedLocation {
  pathname: string
  searchStr: string
  search: Record<string, unknown>
  hash: string
  href: string
  key: string
}

/** URLs of the client entry and stylesheets, injected by <HeadContent /> and <Scripts />. */
export interface Assets {
  entry: string
  css: string[]
  dev: boolean
}

export type MatchStatus = 'pending' | 'success' | 'error' | 'notFound'

export interface Match {
  /** routeId + interpolated path + search: identifies one "instance" of a route. */
  id: string
  routeId: string
  pathname: string
  params: Record<string, string>
  search: Record<string, unknown>
  status: MatchStatus
  loaderData?: unknown
  error?: unknown
  context: Record<string, unknown>
  /** When set, this match renders its notFoundComponent inside its <Outlet />. */
  globalNotFound?: boolean
}

export interface RouterState {
  location: ParsedLocation
  matches: Match[]
  status: 'idle' | 'pending'
  statusCode: number
  /** Server only: a redirect thrown while loading. */
  redirect?: Redirect
}

export interface RouterOptions {
  routeTree: AnyRoute
  history?: RouterHistory
  context?: RouterContext
  /** Preload route data when a <Link> is hovered or focused. Default: 'intent'. */
  defaultPreload?: 'intent' | false
  defaultPreloadDelay?: number
  /** How long preloaded data stays fresh, in ms. Default: 30s. */
  preloadStaleTime?: number
  defaultErrorComponent?: ComponentType<ErrorComponentProps>
  defaultNotFoundComponent?: ComponentType
  scrollRestoration?: boolean
}

export interface DehydratedMatch {
  id: string
  routeId: string
  status: MatchStatus
  loaderData?: unknown
  error?: unknown
  globalNotFound?: boolean
}

/** What the server embeds in the HTML for the client to pick up. */
export interface DehydratedState {
  matches: DehydratedMatch[]
  statusCode: number
  assets: Assets
}

interface BranchMatch {
  routes: AnyRoute[]
  params: Record<string, string>
  score: number[]
}

interface ResolveResult {
  matches: Match[]
  statusCode: number
  redirect?: Redirect
}

type ResolvedOptions = RouterOptions & {
  defaultPreload: 'intent' | false
  defaultPreloadDelay: number
  preloadStaleTime: number
  scrollRestoration: boolean
}

export class Router {
  options: ResolvedOptions
  history: RouterHistory
  routeTree: AnyRoute
  routesById: Record<string, AnyRoute> = {}
  state: RouterState
  /** Set by the server handler (assets + bootstrap script) and by the client hydration step. */
  ssr: { assets: Assets; bootstrapScript?: string } | undefined
  lastAction: HistoryAction = 'PUSH'
  readonly isServer = typeof window === 'undefined'

  private listeners = new Set<() => void>()
  private loadId = 0
  private latestLoad: Promise<void> = Promise.resolve()
  private preloadCache = new Map<string, { data: unknown; at: number }>()
  private unsubscribeHistory: (() => void) | undefined

  constructor(options: RouterOptions) {
    this.options = {
      defaultPreload: 'intent',
      defaultPreloadDelay: 50,
      preloadStaleTime: 30_000,
      scrollRestoration: true,
      ...options,
    }
    this.history =
      options.history ??
      (this.isServer ? createMemoryHistory('/') : createBrowserHistory())
    this.routeTree = options.routeTree
    this.indexRoutes()
    this.state = {
      location: this.parseLocation(this.history.location),
      matches: [],
      status: 'idle',
      statusCode: 200,
    }
  }

  // -- store -----------------------------------------------------------------

  getState = (): RouterState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private setState(partial: Partial<RouterState>) {
    this.state = { ...this.state, ...partial }
    for (const listener of this.listeners) listener()
  }

  // -- route tree ------------------------------------------------------------

  private indexRoutes() {
    this.routesById = {}
    const visit = (route: AnyRoute) => {
      route.router = this
      this.routesById[route.id] = route
      for (const child of route.children) visit(child)
    }
    visit(this.routeTree)
  }

  /** Dev-only (HMR): replace the route tree and re-run loaders. */
  setRouteTree(tree: AnyRoute) {
    this.routeTree = tree
    this.indexRoutes()
    void this.invalidate()
  }

  // -- locations -------------------------------------------------------------

  parseLocation(location: HistoryLocation): ParsedLocation {
    return {
      pathname: location.pathname,
      searchStr: location.search,
      search: parseSearch(location.search),
      hash: location.hash,
      href: location.href,
      key: location.state.key,
    }
  }

  buildLocation(opts: {
    to?: string
    params?: Record<string, string>
    search?: Record<string, unknown>
    hash?: string
  }): ParsedLocation {
    const pathname = interpolatePath(
      opts.to ?? this.state.location.pathname,
      opts.params ?? {},
    )
    const searchStr = stringifySearch(opts.search ?? {})
    const hash = opts.hash
      ? opts.hash.startsWith('#')
        ? opts.hash
        : `#${opts.hash}`
      : ''
    return {
      pathname,
      searchStr,
      search: parseSearch(searchStr),
      hash,
      href: pathname + searchStr + hash,
      key: '',
    }
  }

  // -- matching --------------------------------------------------------------

  /** Find the most specific route branch for a pathname (null if nothing matches). */
  matchRoutes(pathname: string): BranchMatch | null {
    const candidates = collectBranches(
      this.routeTree,
      splitPathname(pathname),
      0,
      {},
    )
    if (candidates.length === 0) return null
    candidates.sort((a, b) => compareScores(b.score, a.score))
    return candidates[0] ?? null
  }

  private buildMatches(location: ParsedLocation): {
    matches: Match[]
    unmatched: boolean
  } {
    const branch = this.matchRoutes(location.pathname)
    const routes = branch?.routes ?? [this.routeTree]
    const params = branch?.params ?? {}
    let validated: Record<string, unknown> = {}

    const matches = routes.map((route): Match => {
      const match: Match = {
        id: `${route.id}|${interpolatePath(route.fullPath, params)}|${location.searchStr}`,
        routeId: route.id,
        pathname: interpolatePath(route.fullPath, params),
        params,
        search: {},
        status: 'pending',
        context: {},
      }
      if (route.options.validateSearch) {
        try {
          validated = {
            ...validated,
            ...route.options.validateSearch(location.search),
          }
        } catch (error) {
          match.status = 'error'
          match.error = error
        }
      }
      match.search = { ...location.search, ...validated }
      return match
    })
    return { matches, unmatched: !branch }
  }

  // -- loading ---------------------------------------------------------------

  /** Load the current history location and commit it to state. */
  load(opts: { invalidate?: boolean } = {}): Promise<void> {
    const promise = this.doLoad(opts)
    this.latestLoad = promise
    return promise
  }

  private async doLoad({ invalidate = false }: { invalidate?: boolean }) {
    const id = ++this.loadId
    const location = this.parseLocation(this.history.location)
    const previous = this.state.location

    // A hash-only change does not need new data.
    if (
      !invalidate &&
      this.state.matches.length > 0 &&
      previous.pathname === location.pathname &&
      previous.searchStr === location.searchStr
    ) {
      this.setState({ location })
      return
    }

    this.setState({ status: 'pending' })
    const result = await this.resolveMatches(location, { invalidate })
    if (id !== this.loadId) return // a newer navigation won

    if (result.redirect) {
      if (this.isServer) {
        this.setState({ redirect: result.redirect, status: 'idle' })
        return
      }
      this.setState({ status: 'idle' })
      const target = result.redirect.options
      if (target.href !== undefined) {
        window.location.assign(target.href)
        return
      }
      await this.commitNavigation({ ...target, replace: true })
      return
    }

    this.setState({
      location,
      matches: result.matches,
      statusCode: result.statusCode,
      status: 'idle',
      redirect: undefined,
    })
  }

  private async resolveMatches(
    location: ParsedLocation,
    opts: { preload?: boolean; invalidate?: boolean },
  ): Promise<ResolveResult> {
    const built = this.buildMatches(location)
    let matches = built.matches
    let statusCode = 200
    const cause = opts.preload
      ? 'preload'
      : opts.invalidate
        ? 'invalidate'
        : 'enter'

    if (built.unmatched) {
      ;(matches[0] as Match).globalNotFound = true
      statusCode = 404
    }

    // notFound() renders at the nearest route that has a notFoundComponent
    // (the root by default): either in place of the throwing route, or in
    // the boundary route's <Outlet />.
    const notFoundAt = (index: number) => {
      let boundary = 0
      for (let j = index; j >= 0; j--) {
        const route = this.routesById[(matches[j] as Match).routeId]
        if (route?.options.notFoundComponent) {
          boundary = j
          break
        }
      }
      if (boundary === index && index > 0) {
        ;(matches[index] as Match).status = 'notFound'
        matches = matches.slice(0, index + 1)
      } else {
        matches = matches.slice(0, boundary + 1)
        ;(matches[boundary] as Match).globalNotFound = true
      }
      statusCode = 404
    }

    const errorAt = (index: number, error: unknown) => {
      const match = matches[index] as Match
      match.status = 'error'
      match.error = error
      matches = matches.slice(0, index + 1)
      statusCode = 500
    }

    // 1. beforeLoad, sequentially, accumulating context.
    let context: Record<string, unknown> = { ...(this.options.context ?? {}) }
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i] as Match
      if (match.status === 'error') {
        errorAt(i, match.error)
        break
      }
      match.context = context
      const beforeLoad = this.routesById[match.routeId]?.options.beforeLoad
      if (!beforeLoad) continue
      try {
        const extra = await beforeLoad({
          params: match.params,
          search: match.search,
          context: context as RouterContext & Record<string, unknown>,
          location,
          cause,
        })
        if (extra && typeof extra === 'object') {
          context = { ...context, ...extra }
          match.context = context
        }
      } catch (error) {
        if (isRedirect(error)) return { matches, statusCode, redirect: error }
        if (isNotFound(error)) notFoundAt(i)
        else errorAt(i, error)
        break
      }
    }

    // 2. loaders, in parallel.
    const failures = await Promise.all(
      matches.map(async (match, index) => {
        if (match.status !== 'pending') return null
        const route = this.routesById[match.routeId] as AnyRoute
        const loader = route.options.loader
        if (!loader) {
          match.status = 'success'
          return null
        }
        if (!opts.invalidate) {
          // Keep data for routes that stay mounted (e.g. a parent layout).
          const active = this.state.matches.find(
            (m) => m.id === match.id && m.status === 'success',
          )
          if (active) {
            match.loaderData = active.loaderData
            match.status = 'success'
            return null
          }
          const cached = this.preloadCache.get(match.id)
          if (cached && Date.now() - cached.at < this.options.preloadStaleTime) {
            match.loaderData = cached.data
            match.status = 'success'
            return null
          }
        }
        try {
          match.loaderData = await loader({
            params: match.params,
            search: match.search,
            context: match.context as RouterContext & Record<string, unknown>,
            location,
            abortController: new AbortController(),
            cause,
          })
          match.status = 'success'
          if (opts.preload) {
            this.preloadCache.set(match.id, {
              data: match.loaderData,
              at: Date.now(),
            })
          }
          return null
        } catch (error) {
          return { index, error }
        }
      }),
    )

    for (const failure of failures) {
      if (!failure) continue
      if (isRedirect(failure.error)) {
        return { matches, statusCode, redirect: failure.error }
      }
      if (isNotFound(failure.error)) notFoundAt(failure.index)
      else errorAt(failure.index, failure.error)
      break
    }

    return { matches, statusCode }
  }

  // -- navigation ------------------------------------------------------------

  /** Start listening to history changes (browser only). Returns an unsubscribe function. */
  mount(): () => void {
    if (this.unsubscribeHistory) return () => {}
    this.unsubscribeHistory = this.history.subscribe((action) => {
      this.lastAction = action
      void this.load()
    })
    return () => {
      this.unsubscribeHistory?.()
      this.unsubscribeHistory = undefined
    }
  }

  /** Typed navigation: `to` must be a registered path and its params are required. */
  navigate = <TTo extends RegisteredPath>(
    opts: NavigateOptions<TTo>,
  ): Promise<void> =>
    this.commitNavigation(opts as unknown as NavigateOptions<string>)

  /** Untyped navigation used internally (links, redirects). */
  commitNavigation(opts: NavigateOptions<string>): Promise<void> {
    const next = this.buildLocation(opts)
    const leaf = this.matchRoutes(next.pathname)?.routes.at(-1)
    if (!this.isServer && leaf?.serverOnly) {
      // API routes are not rendered by the client router.
      window.location.assign(next.href)
      return Promise.resolve()
    }
    if (opts.replace) this.history.replace(next.href)
    else this.history.push(next.href)
    return this.unsubscribeHistory ? this.latestLoad : this.load()
  }

  /** Run beforeLoad + loaders for a location and cache the result (used by <Link preload="intent">). */
  async preloadRoute(opts: NavigateOptions<string>): Promise<void> {
    const location = this.buildLocation(opts)
    try {
      await this.resolveMatches(location, { preload: true })
    } catch {
      // Preloading is best-effort.
    }
  }

  /** Drop cached data and re-run every loader for the current location (e.g. after a mutation). */
  invalidate(): Promise<void> {
    this.preloadCache.clear()
    return this.load({ invalidate: true })
  }

  // -- SSR -------------------------------------------------------------------

  dehydrate(assets: Assets): DehydratedState {
    return {
      matches: this.state.matches.map((m) => {
        const match: DehydratedMatch = { id: m.id, routeId: m.routeId, status: m.status }
        if (m.loaderData !== undefined) match.loaderData = m.loaderData
        if (m.error !== undefined) match.error = m.error
        if (m.globalNotFound) match.globalNotFound = true
        return match
      }),
      statusCode: this.state.statusCode,
      assets,
    }
  }

  /** Adopt the server's results instead of re-running loaders in the browser. */
  hydrate(dehydrated: DehydratedState) {
    this.ssr = { assets: dehydrated.assets }
    const location = this.parseLocation(this.history.location)
    const { matches } = this.buildMatches(location)
    const consistent = dehydrated.matches.every(
      (d, i) => matches[i]?.routeId === d.routeId,
    )
    if (!consistent) {
      console.warn(
        '[mini-start] Server and client matched different routes; loading on the client.',
      )
      this.state = { ...this.state, location }
      void this.load()
      return
    }
    this.state = {
      location,
      matches: dehydrated.matches.map((d, i) => ({
        ...(matches[i] as Match),
        status: d.status,
        loaderData: d.loaderData,
        error: d.error,
        globalNotFound: d.globalNotFound,
        context: { ...(this.options.context ?? {}) },
      })),
      status: 'idle',
      statusCode: dehydrated.statusCode,
    }
  }
}

export function createRouter(options: RouterOptions): Router {
  return new Router(options)
}

// ---------------------------------------------------------------------------
// Matching internals
// ---------------------------------------------------------------------------

// Per-segment scores: static beats dynamic beats splat; an index route beats
// its own layout when the URL ends exactly there.
const SCORE_STATIC = 4
const SCORE_INDEX = 3
const SCORE_PARAM = 2
const SCORE_SPLAT = 1
const SCORE_TERMINAL = 0

function collectBranches(
  route: AnyRoute,
  urlSegments: string[],
  start: number,
  params: Record<string, string>,
): BranchMatch[] {
  let i = start
  const ownParams = { ...params }
  const score: number[] = []

  for (const segment of route.segments) {
    if (segment.type === 'splat') {
      ownParams._splat = urlSegments.slice(i).map(safeDecode).join('/')
      i = urlSegments.length
      score.push(SCORE_SPLAT)
      break
    }
    const part = urlSegments[i]
    if (part === undefined) return []
    if (segment.type === 'static') {
      if (safeDecode(part).toLowerCase() !== segment.value.toLowerCase()) {
        return []
      }
      score.push(SCORE_STATIC)
    } else {
      ownParams[segment.value] = safeDecode(part)
      score.push(SCORE_PARAM)
    }
    i++
  }

  const results: BranchMatch[] = []
  for (const child of route.children) {
    for (const branch of collectBranches(child, urlSegments, i, ownParams)) {
      results.push({
        routes: [route, ...branch.routes],
        params: branch.params,
        score: [...score, ...branch.score],
      })
    }
  }
  // A route can end a branch when it consumed the whole URL. Pathless
  // layouts only ever wrap children.
  if (i === urlSegments.length && !route.isPathless) {
    results.push({
      routes: [route],
      params: ownParams,
      score: [...score, route.isIndex ? SCORE_INDEX : SCORE_TERMINAL],
    })
  }
  return results
}

function compareScores(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const diff = (a[i] ?? -1) - (b[i] ?? -1)
    if (diff !== 0) return diff
  }
  return 0
}
