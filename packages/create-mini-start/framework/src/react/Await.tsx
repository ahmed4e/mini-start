import { type ReactNode, Suspense, use } from 'react'

/**
 * Render deferred loader data. Return an un-awaited promise from a loader and
 * pass it here: the server streams the fallback first, then the resolved
 * content (and the data itself) when the promise settles.
 */
export function Await<T>({
  promise,
  fallback = null,
  children,
}: {
  promise: Promise<T>
  fallback?: ReactNode
  children: (value: T) => ReactNode
}) {
  return (
    <Suspense fallback={fallback}>
      <AwaitValue promise={promise}>{children}</AwaitValue>
    </Suspense>
  )
}

function AwaitValue<T>({
  promise,
  children,
}: {
  promise: Promise<T>
  children: (value: T) => ReactNode
}) {
  return <>{children(use(promise))}</>
}
