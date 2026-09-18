export type FileType = 'json' | 'csv' | 'yaml' | 'image' | 'unknown'

export type DiffChangeType =
  | 'added'
  | 'removed'
  | 'modified'
  | 'type-changed'
  | 'unchanged'
  | 'error'

export interface DiffChange {
  type: DiffChangeType
  path: string
  oldValue?: unknown
  newValue?: unknown
}

export type DiffStatus = 'ok' | 'error' | 'not-implemented'

export interface DiffResult {
  pluginId: string
  status: DiffStatus
  changes: DiffChange[]
  error?: string
}

export interface DiffPlugin {
  id: string
  matches: (filename: string, content: string) => boolean
  diff: (original: string, modified: string) => DiffResult
}

export interface LoadedFile {
  content: string
  type: FileType
  /** Data-URL payload for binary files (images); mirrors content for images. */
  dataUrl?: string
  /** Original file name when dropped/chosen, if any. */
  name?: string
}
