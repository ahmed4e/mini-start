import {
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
} from 'react'
import type { NavigateOptions, RegisteredPath, ToOptions } from '../types.ts'
import { useRouter, useRouterState } from './hooks.ts'

type AnchorProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'href' | 'children'
>

export type LinkProps<TTo extends string = RegisteredPath> = AnchorProps &
  ToOptions<TTo> & {
    replace?: boolean
    /** 'intent' preloads the target's data on hover/focus/touch. */
    preload?: 'intent' | false
    activeProps?: AnchorProps
    inactiveProps?: AnchorProps
    /** By default a link is active for its path and every path below it ('/' is always exact). */
    activeOptions?: { exact?: boolean }
    children?: ReactNode | ((state: { isActive: boolean }) => ReactNode)
  }

/**
 * A real <a href> (works without JavaScript) that navigates client-side when
 * JavaScript is available. `to` and `params` are checked against the
 * generated route tree.
 */
export function Link<TTo extends RegisteredPath>(props: LinkProps<TTo>) {
  const {
    to,
    params,
    search,
    hash,
    replace,
    preload,
    activeProps,
    inactiveProps,
    activeOptions,
    children,
    onClick,
    onMouseEnter,
    onMouseLeave,
    onFocus,
    onTouchStart,
    target,
    className,
    style,
    ...rest
  } = props as LinkProps<string>

  const router = useRouter()
  const pathname = useRouterState((s) => s.location.pathname)
  const navigateOptions = { to, params, search, hash } as NavigateOptions<string>
  const next = router.buildLocation(navigateOptions)

  const exact = activeOptions?.exact ?? next.pathname === '/'
  const isActive = exact
    ? pathname === next.pathname
    : pathname === next.pathname || pathname.startsWith(`${next.pathname}/`)

  const preloadMode = preload ?? router.options.defaultPreload
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const startPreload = () => {
    if (preloadMode !== 'intent') return
    clearTimeout(timer.current)
    timer.current = setTimeout(
      () => void router.preloadRoute(navigateOptions),
      router.options.defaultPreloadDelay,
    )
  }

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey ||
      (target && target !== '_self')
    ) {
      return // let the browser handle new tabs, downloads, etc.
    }
    event.preventDefault()
    void router.commitNavigation({ ...navigateOptions, replace })
  }

  const stateProps = isActive ? activeProps : inactiveProps
  const mergedClassName =
    [className, stateProps?.className].filter(Boolean).join(' ') || undefined
  const mergedStyle =
    style || stateProps?.style ? { ...style, ...stateProps?.style } : undefined

  return (
    <a
      {...rest}
      {...stateProps}
      className={mergedClassName}
      style={mergedStyle}
      href={next.href}
      target={target}
      data-status={isActive ? 'active' : undefined}
      aria-current={isActive ? 'page' : undefined}
      onClick={handleClick}
      onMouseEnter={(event) => {
        onMouseEnter?.(event)
        startPreload()
      }}
      onMouseLeave={(event) => {
        onMouseLeave?.(event)
        clearTimeout(timer.current)
      }}
      onFocus={(event) => {
        onFocus?.(event)
        startPreload()
      }}
      onTouchStart={(event) => {
        onTouchStart?.(event)
        if (preloadMode === 'intent') void router.preloadRoute(navigateOptions)
      }}
    >
      {typeof children === 'function' ? children({ isActive }) : children}
    </a>
  )
}
