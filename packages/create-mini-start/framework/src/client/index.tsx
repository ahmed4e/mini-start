/**
 * Browser entry: adopt the server's state and hydrate the whole document.
 * The generated virtual client entry calls `hydrateStart(getRouter)`.
 */
import { startTransition } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { RouterProvider } from '../react/RouterProvider.tsx'
import type { DehydratedState, Router } from '../router/router.ts'
import { decode } from '../ssr/serializer.ts'

interface MiniGlobal {
  state?: unknown
  /** Promise results that arrived before the client asked for them. */
  s: Record<number, [boolean, unknown]>
  /** Resolvers waiting for promise results. */
  w: Record<number, (ok: boolean, value: unknown) => void>
}

declare global {
  interface Window {
    __MINI__?: MiniGlobal
  }
}

export function hydrateStart(getRouter: () => Router): Router {
  const router = getRouter()
  const mini = window.__MINI__
  if (!mini || mini.state === undefined) {
    throw new Error('[mini-start] No server state found in the page.')
  }

  const getPromise = (id: number): Promise<unknown> => {
    const promise = new Promise<unknown>((resolve, reject) => {
      const settle = (ok: boolean, value: unknown) => {
        const decoded = decode(value, { getPromise })
        if (ok) resolve(decoded)
        else reject(decoded)
      }
      const early = mini.s[id]
      if (early) {
        delete mini.s[id]
        settle(early[0], early[1])
      } else {
        mini.w[id] = (ok, value) => {
          delete mini.w[id]
          settle(ok, value)
        }
      }
    })
    // Rejections are surfaced by <Await>; don't also report them as unhandled.
    promise.catch(() => {})
    return promise
  }

  router.hydrate(decode(mini.state, { getPromise }) as DehydratedState)

  startTransition(() => {
    hydrateRoot(document, <RouterProvider router={router} />)
  })
  return router
}
