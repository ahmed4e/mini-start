import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorFallback } from '../components/organisms/ErrorFallback'

interface State {
  error: Error | null
}

/**
 * Catches errors thrown while rendering anything inside it, and shows the
 * fallback. src/main.tsx wraps the whole app in one; wrap smaller parts in
 * their own to keep the rest of the page alive.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // Send this to your error tracker.
    console.error(error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (error) return <ErrorFallback error={error} onRetry={() => this.setState({ error: null })} />
    return this.props.children
  }
}
