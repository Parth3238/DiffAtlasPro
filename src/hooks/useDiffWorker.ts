import { useCallback, useEffect, useRef, useState } from 'react'
import { registry } from '../lib/diff-engine/core/registry.ts'
import type { DiffResult } from '../lib/diff-engine/core/types.ts'
import type {
  DiffWorkerRequest,
  DiffWorkerResponse,
} from '../lib/diff-engine/workers/diffWorker.ts'
import DiffWorkerFactory from '../lib/diff-engine/workers/diffWorker.ts?worker'

export interface UseDiffWorker {
  runDiff: (fileType: string, original: string, modified: string) => void
  result: DiffResult | null
  isComputing: boolean
  error: string | null
}

/**
 * Runs diff computation inside a Web Worker so large files never block the
 * main thread. Falls back to a synchronous main-thread diff when Workers are
 * unavailable. The worker is terminated on unmount, and stale responses from
 * superseded runs are ignored via request ids.
 */
export function useDiffWorker(): UseDiffWorker {
  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)
  const [result, setResult] = useState<DiffResult | null>(null)
  const [isComputing, setIsComputing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let worker: Worker | null = null
    try {
      worker = new DiffWorkerFactory()
    } catch {
      worker = null
    }
    if (worker) {
      workerRef.current = worker
      worker.onmessage = (event: MessageEvent<DiffWorkerResponse>) => {
        const data = event.data
        if (!data || data.id !== requestIdRef.current) return
        setIsComputing(false)
        if (data.error !== undefined) {
          setError(data.error)
        } else if (data.result) {
          setResult(data.result)
        }
      }
      worker.onerror = () => {
        setIsComputing(false)
        setError('Diff worker crashed unexpectedly')
      }
    }
    return () => {
      workerRef.current = null
      worker?.terminate()
    }
  }, [])

  const runDiff = useCallback((fileType: string, original: string, modified: string) => {
    requestIdRef.current += 1
    const id = requestIdRef.current
    setIsComputing(true)
    setError(null)

    const worker = workerRef.current
    if (worker) {
      const message: DiffWorkerRequest = { id, fileType, original, modified }
      worker.postMessage(message)
      return
    }

    try {
      const plugin = registry.get(fileType)
      if (!plugin) {
        if (requestIdRef.current !== id) return
        setIsComputing(false)
        setError(`No diff plugin registered for file type "${fileType}"`)
        return
      }
      const syncResult = plugin.diff(original, modified)
      if (requestIdRef.current !== id) return
      setResult(syncResult)
      setIsComputing(false)
    } catch (err) {
      if (requestIdRef.current !== id) return
      setIsComputing(false)
      setError(err instanceof Error ? err.message : 'Diff failed')
    }
  }, [])

  return { runDiff, result, isComputing, error }
}
