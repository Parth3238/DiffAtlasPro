import { Component, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

/**
 * Catches rendering errors anywhere below it and shows a friendly fallback
 * instead of a blank white screen. State is local-only; reloading resets it.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: unknown): void {
    console.error('[DiffAtlas] Uncaught render error:', error)
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="mx-auto flex min-h-dvh max-w-6xl flex-col items-center justify-center gap-4 px-6 py-10 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Something went wrong</h1>
          <p className="max-w-md text-sm text-zinc-400">
            DiffAtlas hit an unexpected error while rendering. Your files never leave the browser,
            so nothing was uploaded — try reloading to start fresh.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            autoFocus
            className="rounded-md bg-teal-600 px-5 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-teal-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400"
          >
            Reload
          </button>
        </main>
      )
    }
    return this.props.children
  }
}
