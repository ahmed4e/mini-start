/**
 * Minimal history abstraction: the browser implementation wraps
 * `history.pushState`, the memory implementation is used on the server
 * (one per request) and in tests.
 */

export interface HistoryLocation {
  pathname: string
  search: string
  hash: string
  href: string
  state: { key: string }
}

export type HistoryAction = 'PUSH' | 'REPLACE' | 'POP'

export interface RouterHistory {
  location: HistoryLocation
  push(href: string): void
  replace(href: string): void
  go(delta: number): void
  back(): void
  subscribe(listener: (action: HistoryAction) => void): () => void
}

function createKey() {
  return Math.random().toString(36).slice(2, 10)
}

export function parseHref(
  href: string,
  state: { key: string } = { key: createKey() },
): HistoryLocation {
  const url = new URL(href, 'http://mini-start.local')
  return {
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    href: url.pathname + url.search + url.hash,
    state,
  }
}

export function createBrowserHistory(): RouterHistory {
  const listeners = new Set<(action: HistoryAction) => void>()

  const read = (): HistoryLocation => {
    const state = (window.history.state as { key?: string } | null) ?? {}
    const key = state.key ?? createKey()
    if (!state.key) {
      window.history.replaceState({ ...state, key }, '')
    }
    return parseHref(
      window.location.pathname + window.location.search + window.location.hash,
      { key },
    )
  }

  const history: RouterHistory = {
    location: read(),
    push(href) {
      const key = createKey()
      window.history.pushState({ key }, '', href)
      history.location = parseHref(href, { key })
      for (const l of listeners) l('PUSH')
    },
    replace(href) {
      const key = createKey()
      window.history.replaceState({ key }, '', href)
      history.location = parseHref(href, { key })
      for (const l of listeners) l('REPLACE')
    },
    go: (delta) => window.history.go(delta),
    back: () => window.history.back(),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  window.addEventListener('popstate', () => {
    history.location = read()
    for (const l of listeners) l('POP')
  })

  return history
}

export function createMemoryHistory(initial = '/'): RouterHistory {
  const listeners = new Set<(action: HistoryAction) => void>()
  const entries: HistoryLocation[] = [parseHref(initial)]
  let index = 0

  const history: RouterHistory = {
    location: entries[0] as HistoryLocation,
    push(href) {
      entries.splice(index + 1)
      entries.push(parseHref(href))
      index = entries.length - 1
      history.location = entries[index] as HistoryLocation
      for (const l of listeners) l('PUSH')
    },
    replace(href) {
      entries[index] = parseHref(href)
      history.location = entries[index] as HistoryLocation
      for (const l of listeners) l('REPLACE')
    },
    go(delta) {
      index = Math.min(Math.max(index + delta, 0), entries.length - 1)
      history.location = entries[index] as HistoryLocation
      for (const l of listeners) l('POP')
    },
    back: () => history.go(-1),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return history
}
