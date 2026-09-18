import { registry } from '../core/registry.ts'
import type { DiffResult } from '../core/types.ts'

export interface DiffWorkerRequest {
  /** Sequencing id so the main thread can ignore stale responses. */
  id: number
  fileType: string
  original: string
  modified: string
}

export interface DiffWorkerResponse {
  /** Echoes the request id this response belongs to. */
  id: number
  result?: DiffResult
  error?: string
}

globalThis.onmessage = (event: MessageEvent<DiffWorkerRequest>) => {
  const { id, fileType, original, modified } = event.data
  try {
    const plugin = registry.get(fileType)
    if (!plugin) {
      const response: DiffWorkerResponse = {
        id,
        error: `No diff plugin registered for file type "${fileType}"`,
      }
      globalThis.postMessage(response)
      return
    }
    const result = plugin.diff(original, modified)
    const response: DiffWorkerResponse = { id, result }
    globalThis.postMessage(response)
  } catch (error) {
    const response: DiffWorkerResponse = {
      id,
      error: error instanceof Error ? error.message : 'Diff failed',
    }
    globalThis.postMessage(response)
  }
}

export {}
