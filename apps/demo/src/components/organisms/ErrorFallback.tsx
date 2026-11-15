import styles from './ErrorFallback.module.css'

/** What people see when the app crashes, instead of a blank page. */
export function ErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <main className={styles.screen} role="alert">
      <h1>Something went wrong</h1>
      <p className="muted">{error.message}</p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </main>
  )
}
