/**
 * <HeadContent /> goes in <head>, <Scripts /> at the end of <body> in the
 * root route. Together they are the only "framework" markup in the document.
 */
import { useState } from 'react'
import type { AnyRoute, HeadTag } from '../router/route.ts'
import type { Match, Router } from '../router/router.ts'
import { useRouter, useRouterState } from './hooks.ts'

export const STATE_SCRIPT_ID = '__mini_start_state'

export function HeadContent() {
  const router = useRouter()
  const matches = useRouterState((s) => s.matches)
  const { title, meta, links } = collectHead(router, matches)
  const assets = router.ssr?.assets

  return (
    <>
      {title !== undefined && <title>{title}</title>}
      {meta.map((attrs) => (
        <meta key={metaKey(attrs)} {...attrs} />
      ))}
      {links.map((attrs, i) => (
        <link key={`${attrs.rel}:${attrs.href}:${i}`} {...attrs} />
      ))}
      {assets?.css.map((href) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      {assets && !assets.dev && (
        <link rel="modulepreload" href={assets.entry} />
      )}
    </>
  )
}

/**
 * Emits the dehydrated router state and boots the client entry.
 *
 * The entry is loaded from an inline `async` module script: it runs as soon
 * as it is parsed (right after the state script) instead of waiting for the
 * whole streamed document, so hydration starts while deferred data is still
 * streaming in.
 */
export function Scripts() {
  const router = useRouter()
  // On the client, reuse the exact text the server rendered so hydration matches.
  const [stateScript] = useState(() =>
    router.isServer
      ? (router.ssr?.bootstrapScript ?? '')
      : (document.getElementById(STATE_SCRIPT_ID)?.textContent ?? ''),
  )
  const assets = router.ssr?.assets
  if (!assets) return null

  const boot =
    (assets.dev ? 'import("/@vite/client");' : '') +
    `import(${JSON.stringify(assets.entry)});`

  return (
    <>
      <script
        id={STATE_SCRIPT_ID}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: stateScript }}
      />
      <script
        type="module"
        async
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: boot }}
      />
    </>
  )
}

function collectHead(router: Router, matches: Match[]) {
  let title: string | undefined
  const meta = new Map<string, HeadTag>()
  const links: HeadTag[] = []

  for (const match of matches) {
    if (match.status !== 'success') continue
    const route = router.routesById[match.routeId] as AnyRoute | undefined
    const head = route?.options.head?.({
      loaderData: match.loaderData,
      params: match.params,
    })
    if (!head) continue
    for (const entry of head.meta ?? []) {
      if (entry.title !== undefined) title = entry.title
      else meta.set(metaKey(entry), entry)
    }
    links.push(...(head.links ?? []))
  }
  return { title, meta: [...meta.values()], links }
}

function metaKey(attrs: HeadTag): string {
  if (attrs.charSet) return 'charset'
  return (
    attrs.name ?? attrs.property ?? attrs.httpEquiv ?? JSON.stringify(attrs)
  )
}
