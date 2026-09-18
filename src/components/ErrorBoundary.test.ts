import { describe, expect, it } from 'vitest'
import ErrorBoundary from './ErrorBoundary.tsx'

describe('ErrorBoundary', () => {
  it('switches to the fallback state when a render error is derived', () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ hasError: true })
  })

  it('starts without an error', () => {
    const boundary = new ErrorBoundary({ children: null })
    expect(boundary.state).toEqual({ hasError: false })
  })
})
