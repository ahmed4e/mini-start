/**
 * Rendering: <RouterProvider> renders the root match; each route component
 * renders <Outlet /> to show the next match down the branch. Every match gets
 * its own error boundary, so a failing child keeps its parent layouts alive.
 */
import {
  Component,
  type ComponentType,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react'
import type { AnyRoute, ErrorComponentProps } from '../router/route.ts'
import type { Router } from '../router/router.ts'
import { MatchIndexContext, RouterContext } from './context.ts'
import { HeadContent, Scripts } from './Document.tsx'
import { useRouter, useRouterState } from './hooks.ts'

export function RouterProvider({ router }: { router: Router }) {
  return (
    <RouterContext.Provider value={router}>
      <RouterLifecycle />
      <MatchView index={0} />
    </RouterContext.Provider>
  )
}

/** Subscribes the router to browser history and handles scroll restoration. */
function RouterLifecycle() {
  const router = useRouter()
  const location = useRouterState((s) => s.location)

  useEffect(() => router.mount(), [router])

  useEffect(() => {
    if (!router.options.scrollRestoration) return
    window.history.scrollRestoration = 'manual'
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        scrollPositions.set(router.state.location.key, window.scrollY)
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [router])

  // Skip the initial (hydration) render: the browser already restored scroll.
  const mounted = useRef(false)
  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    if (!router.options.scrollRestoration) return
    if (router.lastAction === 'POP') {
      window.scrollTo(0, scrollPositions.get(location.key) ?? 0)
    } else if (location.hash) {
      document.getElementById(location.hash.slice(1))?.scrollIntoView()
    } else {
      window.scrollTo(0, 0)
    }
  }, [location.href, location.key])

  return null
}

/** history entry key -> scrollY, so back/forward restores the position. */
const scrollPositions = new Map<string, number>()

function MatchView({ index }: { index: number }) {
  const router = useRouter()
  const match = useRouterState((s) => s.matches[index])
  if (!match) return null
  const route = router.routesById[match.routeId] as AnyRoute
  const ErrorComponent = getErrorComponent(router, route)

  return (
    <MatchIndexContext.Provider value={index}>
      <CatchBoundary
        resetKey={match.id}
        fallback={(error, reset) =>
          wrapRootFallback(
            route,
            <ErrorComponent error={error} reset={reset} />,
          )
        }
      >
        <MatchContent route={route} index={index} />
      </CatchBoundary>
    </MatchIndexContext.Provider>
  )
}

function MatchContent({ route, index }: { route: AnyRoute; index: number }) {
  const router = useRouter()
  const match = useRouterState((s) => s.matches[index])
  if (!match) return null

  if (match.status === 'error') {
    const ErrorComponent = getErrorComponent(router, route)
    const error =
      match.error instanceof Error
        ? match.error
        : new Error(String(match.error))
    return wrapRootFallback(
      route,
      <ErrorComponent error={error} reset={() => void router.invalidate()} />,
    )
  }
  if (match.status === 'notFound') {
    const NotFound = getNotFoundComponent(router, route)
    return <NotFound />
  }
  const RouteComponent = route.options.component ?? Outlet
  return <RouteComponent />
}

/** Renders the next matched route (or the notFoundComponent at a not-found boundary). */
export function Outlet() {
  const router = useRouter()
  const index = useContext(MatchIndexContext)
  const parent = useRouterState((s) => s.matches[index])
  const hasChild = useRouterState((s) => s.matches.length > index + 1)

  if (parent?.globalNotFound) {
    const route = router.routesById[parent.routeId] as AnyRoute
    const NotFound = getNotFoundComponent(router, route)
    return <NotFound />
  }
  return hasChild ? <MatchView index={index + 1} /> : null
}

function getErrorComponent(
  router: Router,
  route: AnyRoute,
): ComponentType<ErrorComponentProps> {
  return (
    route.options.errorComponent ??
    router.options.defaultErrorComponent ??
    DefaultErrorComponent
  )
}

function getNotFoundComponent(router: Router, route: AnyRoute): ComponentType {
  return (
    route.options.notFoundComponent ??
    router.options.defaultNotFoundComponent ??
    DefaultNotFound
  )
}

/** The root route renders <html>; if it fails we still need a document to hydrate. */
function wrapRootFallback(route: AnyRoute, content: ReactNode) {
  if (!route.isRoot) return content
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {content}
        <Scripts />
      </body>
    </html>
  )
}

function DefaultErrorComponent({ error, reset }: ErrorComponentProps) {
  return (
    <div role="alert" style={{ padding: 16, border: '1px solid #e11d48' }}>
      <strong>Something went wrong.</strong>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{error.message}</pre>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </div>
  )
}

function DefaultNotFound() {
  return (
    <div style={{ padding: 16 }}>
      <strong>Not found.</strong> The page you requested does not exist.
    </div>
  )
}

interface BoundaryProps {
  resetKey: string
  fallback: (error: Error, reset: () => void) => ReactNode
  children: ReactNode
}

class CatchBoundary extends Component<
  BoundaryProps,
  { error: Error | null; resetKey: string }
> {
  state = { error: null as Error | null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  static getDerivedStateFromProps(
    props: BoundaryProps,
    state: { error: Error | null; resetKey: string },
  ) {
    // Navigating to a different match clears the error.
    return props.resetKey !== state.resetKey
      ? { error: null, resetKey: props.resetKey }
      : null
  }

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error, () =>
        this.setState({ error: null }),
      )
    }
    return this.props.children
  }
}
