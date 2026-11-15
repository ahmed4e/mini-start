import { useCallback, useContext, useRef, useSyncExternalStore } from 'react'
import type { Match, ParsedLocation, Router, RouterState } from '../router/router.ts'
import type { NavigateOptions, RegisteredPath } from '../types.ts'
import { RouterContext } from './context.ts'

export function useRouter(): Router {
  const router = useContext(RouterContext)
  if (!router) {
    throw new Error('useRouter must be used inside <RouterProvider>')
  }
  return router
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null ||
    Array.isArray(a) !== Array.isArray(b)
  ) {
    return false
  }
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  return keysA.every((key) =>
    Object.is(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    ),
  )
}

/**
 * Subscribe to router state. With a selector, the component only re-renders
 * when the selected value changes (shallow comparison).
 */
export function useRouterState<T = RouterState>(
  select?: (state: RouterState) => T,
): T {
  const router = useRouter()
  const cache = useRef<{ state: RouterState; value: T } | null>(null)

  const getSnapshot = (): T => {
    const state = router.getState()
    const cached = cache.current
    if (cached && cached.state === state) return cached.value
    const value = select ? select(state) : (state as unknown as T)
    if (cached && shallowEqual(cached.value, value)) {
      cache.current = { state, value: cached.value }
      return cached.value
    }
    cache.current = { state, value }
    return value
  }

  return useSyncExternalStore(router.subscribe, getSnapshot, getSnapshot)
}

export function useMatches(): Match[] {
  return useRouterState((s) => s.matches)
}

export function useLocation(): ParsedLocation {
  return useRouterState((s) => s.location)
}

/** Params of the deepest matched route (use `Route.useParams()` for typed params). */
export function useParams(): Record<string, string> {
  return useRouterState((s) => s.matches.at(-1)?.params ?? {})
}

/** Search of the deepest matched route (use `Route.useSearch()` for typed search). */
export function useSearch(): Record<string, unknown> {
  return useRouterState((s) => s.matches.at(-1)?.search ?? {})
}

export function useNavigate() {
  const router = useRouter()
  return useCallback(
    <TTo extends RegisteredPath>(opts: NavigateOptions<TTo>) =>
      router.navigate(opts),
    [router],
  )
}
