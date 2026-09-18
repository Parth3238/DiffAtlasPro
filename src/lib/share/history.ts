import type { LoadedFile } from '../diff-engine/core/types.ts'
import type { RecentDiff } from '../storage/indexedDb.ts'

/**
 * Full file content is stored only when both sides fit under this cap
 * (characters, combined). Larger diffs still get a lightweight record with
 * names/types/summary, but cannot be reloaded from history.
 */
export const HISTORY_CONTENT_LIMIT = 200_000

export interface HistorySummary {
  added: number
  removed: number
  modified: number
  typeChanged: number
  unchanged: number
}

export function formatHistorySummary(summary: HistorySummary): string {
  const line =
    `${summary.added} added, ${summary.removed} removed, ` +
    `${summary.modified} modified, ${summary.typeChanged} type changes`
  return summary.unchanged > 0 ? `${line}, ${summary.unchanged} unchanged` : line
}

/** Short stable signature used to avoid saving duplicate records. */
export function historySignature(a: LoadedFile, b: LoadedFile): string {
  return `${a.type}:${a.content.length}:${b.type}:${b.content.length}:${hashString(a.content)}:${hashString(b.content)}`
}

function hashString(value: string): string {
  let hash = 5381
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}

export function makeHistoryId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function buildHistoryRecord(
  original: LoadedFile,
  modified: LoadedFile,
  summaryLine: string,
  createdAt: number = Date.now(),
): RecentDiff {
  const fits = original.content.length + modified.content.length <= HISTORY_CONTENT_LIMIT
  return {
    id: makeHistoryId(),
    original: fits ? original : { ...original, content: '', dataUrl: undefined },
    modified: fits ? modified : { ...modified, content: '', dataUrl: undefined },
    createdAt,
    summaryLine,
    contentOmitted: fits ? undefined : true,
  }
}

/** Records with omitted content cannot be reloaded into the panels. */
export function canReloadHistory(entry: RecentDiff): boolean {
  return !entry.contentOmitted && !!entry.original.content && !!entry.modified.content
}
