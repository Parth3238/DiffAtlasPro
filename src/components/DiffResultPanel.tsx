import { useEffect, useMemo, useRef } from 'react'
import { useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { DiffChange, DiffResult } from '../lib/diff-engine/core/types.ts'
import { toJsonPatch } from '../lib/export/jsonPatchExport.ts'
import { downloadBlob, exportToPdf } from '../lib/export/pdfExport.ts'

interface DiffResultPanelProps {
  result: DiffResult | null
  isComputing?: boolean
  originalName?: string
  modifiedName?: string
}

const MAX_PDF_ROWS = 500

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const ok = document.execCommand('copy')
  textarea.remove()
  if (!ok) throw new Error('clipboard unavailable')
}

function Spinner({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-2 text-xs text-teal-200">
      <svg
        className="h-4 w-4 animate-spin text-teal-300"
        viewBox="0 0 24 24"
        fill="none"
        role="img"
        aria-label={label}
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path
          className="opacity-90"
          fill="currentColor"
          d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
        />
      </svg>
      {label}
    </span>
  )
}

function formatValue(value: unknown): string {
  if (value === undefined) return '—'
  try {
    const serialized = JSON.stringify(value)
    return serialized === undefined ? String(value) : serialized
  } catch {
    return String(value)
  }
}

function formatCell(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : formatValue(value)
}

function displayPath(path: string): string {
  if (!path || path === '$') return '(root)'
  return path
}

/** Top-level section for grouping, e.g. "user.address.city" -> "user". Flat keys fall under "(root)". */
function groupForPath(path: string): string {
  if (!path || path === '$') return '(root)'
  const match = /^([^.[]+)/.exec(path)
  if (!match) return '(root)'
  const top = match[1]
  if (path === top) return '(root)'
  return top || '(root)'
}

function depthForPath(path: string): number {
  if (!path) return 0
  const dots = (path.match(/\./g) ?? []).length
  const brackets = (path.match(/\[/g) ?? []).length
  return dots + brackets
}

function rowClasses(type: DiffChange['type']): string {
  switch (type) {
    case 'added':
      return 'border-emerald-800/60 bg-emerald-950/40'
    case 'removed':
      return 'border-red-800/60 bg-red-950/40'
    case 'modified':
      return 'border-amber-700/60 bg-amber-950/30'
    case 'type-changed':
      return 'border-purple-700/60 bg-purple-950/30'
    case 'error':
      return 'border-red-700/70 bg-red-950/50'
    default:
      return 'border-zinc-800 bg-zinc-900/40'
  }
}

function badgeClasses(type: DiffChange['type']): string {
  switch (type) {
    case 'added':
      return 'border-emerald-700/60 bg-emerald-600/15 text-emerald-300'
    case 'removed':
      return 'border-red-700/60 bg-red-600/15 text-red-300'
    case 'modified':
      return 'border-amber-700/60 bg-amber-600/15 text-amber-200'
    case 'type-changed':
      return 'border-purple-700/60 bg-purple-600/15 text-purple-200'
    case 'error':
      return 'border-red-700/60 bg-red-600/20 text-red-200'
    default:
      return 'border-zinc-700 bg-zinc-800/60 text-zinc-400'
  }
}

/* ------------------------------------------------------------------ */
/* CSV table model (pure, derived from the shared DiffResult shape)     */
/* ------------------------------------------------------------------ */

export type CsvCellStatus = 'added' | 'removed' | 'modified' | 'unchanged'

export interface CsvCellView {
  column: string
  oldValue: string
  newValue: string
  status: CsvCellStatus
}

export type CsvRowStatus = 'added' | 'removed' | 'modified' | 'unchanged'

export interface CsvRowView {
  key: string
  /** 1-based data-row number in the file the row comes from. */
  label: string
  status: CsvRowStatus
  cells: CsvCellView[]
}

export interface CsvTableModel {
  columns: string[]
  rows: CsvRowView[]
}

const CSV_PATH_RE = /^row\[(\d+)\](?:\.(.+))?$/

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

/**
 * Groups flat CSV DiffChanges into aligned table rows. Matched rows keep the
 * original (A) index so paths stay stable when rows move; added rows use the
 * modified (B) index, mirroring the engine. Column order is first-seen order.
 */
export function buildCsvTableModel(changes: DiffChange[], showUnchanged: boolean): CsvTableModel {
  const columns: string[] = []
  const seenColumns = new Set<string>()
  const noteColumn = (column: string) => {
    if (!seenColumns.has(column)) {
      seenColumns.add(column)
      columns.push(column)
    }
  }

  interface RawRow {
    kind: 'matched' | 'added' | 'removed'
    index: number
    cells: Map<string, { oldValue: string; newValue: string; status: CsvCellStatus }>
  }
  const rows: RawRow[] = []
  const matchedByA = new Map<number, RawRow>()
  const addedByB = new Map<number, RawRow>()

  for (const change of changes) {
    const match = CSV_PATH_RE.exec(change.path)
    if (!match) continue
    const index = Number(match[1])
    const column = match[2]
    if (column !== undefined) {
      noteColumn(column)
      let row = matchedByA.get(index)
      if (!row) {
        row = { kind: 'matched', index, cells: new Map() }
        matchedByA.set(index, row)
        rows.push(row)
      }
      row.cells.set(column, {
        oldValue: formatCell(change.oldValue),
        newValue: formatCell(change.newValue),
        status: change.type === 'unchanged' ? 'unchanged' : 'modified',
      })
    } else if (change.type === 'added') {
      const record = asRecord(change.newValue)
      for (const key of Object.keys(record)) noteColumn(key)
      let row = addedByB.get(index)
      if (!row) {
        row = { kind: 'added', index, cells: new Map() }
        addedByB.set(index, row)
        rows.push(row)
      }
      for (const [key, value] of Object.entries(record)) {
        row.cells.set(key, { oldValue: '', newValue: formatCell(value), status: 'added' })
      }
    } else if (change.type === 'removed') {
      const record = asRecord(change.oldValue)
      for (const key of Object.keys(record)) noteColumn(key)
      const row: RawRow = { kind: 'removed', index, cells: new Map() }
      rows.push(row)
      for (const [key, value] of Object.entries(record)) {
        row.cells.set(key, { oldValue: formatCell(value), newValue: '', status: 'removed' })
      }
    }
  }

  const outRows: CsvRowView[] = []
  for (const row of rows) {
    if (row.kind === 'added') {
      outRows.push({
        key: `added-${row.index}`,
        label: String(row.index + 1),
        status: 'added',
        cells: columns.map((column) => {
          const cell = row.cells.get(column)
          return {
            column,
            oldValue: '',
            newValue: cell?.newValue ?? '',
            status: 'added' as const,
          }
        }),
      })
      continue
    }
    if (row.kind === 'removed') {
      outRows.push({
        key: `removed-${row.index}-${outRows.length}`,
        label: String(row.index + 1),
        status: 'removed',
        cells: columns.map((column) => {
          const cell = row.cells.get(column)
          return {
            column,
            oldValue: cell?.oldValue ?? '',
            newValue: '',
            status: 'removed' as const,
          }
        }),
      })
      continue
    }
    const cells: CsvCellView[] = []
    let hasModified = false
    for (const column of columns) {
      const cell = row.cells.get(column)
      if (!cell) continue
      if (cell.status === 'modified') hasModified = true
      if (!showUnchanged && cell.status === 'unchanged') continue
      cells.push({ column, ...cell })
    }
    if (!showUnchanged && cells.length === 0) continue
    outRows.push({
      key: `matched-${row.index}`,
      label: String(row.index + 1),
      status: hasModified ? 'modified' : 'unchanged',
      cells,
    })
  }

  return { columns, rows: outRows }
}

const CSV_ROW_HEIGHT = 40

function CsvTableView({ result, showUnchanged }: { result: DiffResult; showUnchanged: boolean }) {
  const model = useMemo(
    () => buildCsvTableModel(result.changes, showUnchanged),
    [result, showUnchanged],
  )
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: model.rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CSV_ROW_HEIGHT,
    overscan: 12,
  })

  const gridTemplateColumns = useMemo(
    () => `64px repeat(${Math.max(model.columns.length, 1)}, minmax(0, 1fr))`,
    [model.columns.length],
  )

  if (model.rows.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
        <span>
          {model.rows.length} row{model.rows.length === 1 ? '' : 's'}
          {model.rows.length > 50 && ' (virtualized)'}
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-600/70" /> Added row
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm bg-red-600/70" /> Removed row
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500/80" /> Changed cell
        </span>
      </div>
      <div
        ref={parentRef}
        role="region"
        aria-label="Scrollable CSV diff results"
        tabIndex={0}
        className="h-[480px] overflow-auto rounded-lg border border-zinc-800 bg-zinc-950/50"
      >
        <div
          className="min-w-full"
          style={
            model.columns.length > 3
              ? { minWidth: `${64 + model.columns.length * 150}px` }
              : undefined
          }
        >
          <div
            className="sticky top-0 z-10 grid border-b border-zinc-700 bg-zinc-900"
            style={{ gridTemplateColumns }}
          >
            <div className="px-2 py-2 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
              Row
            </div>
            {model.columns.map((column) => (
              <div
                key={column}
                title={column}
                className="truncate px-2 py-2 font-mono text-[11px] font-semibold text-zinc-300"
              >
                {column}
              </div>
            ))}
          </div>
          <div
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = model.rows[virtualRow.index]
              const rowBg =
                row.status === 'added'
                  ? 'bg-emerald-950/50'
                  : row.status === 'removed'
                    ? 'bg-red-950/50'
                    : 'border-b border-zinc-800/60'
              return (
                <div
                  key={row.key}
                  className={`absolute top-0 left-0 grid w-full ${rowBg}`}
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                    gridTemplateColumns,
                  }}
                >
                  <div className="flex items-center gap-1.5 overflow-hidden px-2">
                    <span
                      role="img"
                      aria-label={`${row.status} row`}
                      className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                        row.status === 'added'
                          ? 'bg-emerald-500'
                          : row.status === 'removed'
                            ? 'bg-red-500'
                            : row.status === 'modified'
                              ? 'bg-amber-500'
                              : 'bg-zinc-700'
                      }`}
                    />
                    <span className="truncate font-mono text-xs text-zinc-400">{row.label}</span>
                  </div>
                  {row.cells.map((cell) => {
                    if (row.status === 'added') {
                      return (
                        <div
                          key={cell.column}
                          title={cell.newValue}
                          className="flex items-center overflow-hidden px-2 font-mono text-xs text-emerald-200"
                        >
                          <span className="truncate">{cell.newValue}</span>
                        </div>
                      )
                    }
                    if (row.status === 'removed') {
                      return (
                        <div
                          key={cell.column}
                          title={cell.oldValue}
                          className="flex items-center overflow-hidden px-2 font-mono text-xs text-red-200/80 line-through"
                        >
                          <span className="truncate">{cell.oldValue}</span>
                        </div>
                      )
                    }
                    if (cell.status === 'modified') {
                      return (
                        <div
                          key={cell.column}
                          title={`${cell.oldValue} → ${cell.newValue}`}
                          className="m-0.5 flex items-center overflow-hidden rounded bg-amber-500/15 px-1.5 font-mono text-xs"
                        >
                          <span className="truncate">
                            <span className="text-red-300/80 line-through">{cell.oldValue}</span>
                            <span className="text-zinc-500"> → </span>
                            <span className="text-amber-100">{cell.newValue}</span>
                          </span>
                        </div>
                      )
                    }
                    return (
                      <div
                        key={cell.column}
                        title={cell.newValue}
                        className="flex items-center overflow-hidden px-2 font-mono text-xs text-zinc-500"
                      >
                        <span className="truncate">{cell.newValue}</span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export function JsonTreeView({ changes }: { changes: DiffChange[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, DiffChange[]>()
    for (const change of changes) {
      const group = groupForPath(change.path)
      const list = map.get(group)
      if (list) list.push(change)
      else map.set(group, [change])
    }
    const entries = [...map.entries()].map(
      ([group, items]) =>
        [group, [...items].sort((a, b) => a.path.localeCompare(b.path))] as const,
    )
    entries.sort(([a], [b]) => {
      if (a === '(root)') return -1
      if (b === '(root)') return 1
      return a.localeCompare(b)
    })
    return entries
  }, [changes])

  return (
    <div className="flex flex-col gap-5">
      {grouped.map(([group, items]) => (
        <div key={group} className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-zinc-400 uppercase">
            <span className="rounded border border-zinc-700 bg-zinc-950/70 px-1.5 py-0.5 font-mono normal-case">
              {group}
            </span>
            <span className="font-sans font-normal normal-case text-zinc-600">
              {items.length} change{items.length === 1 ? '' : 's'}
            </span>
          </h3>
          <ul aria-label="JSON structural changes" className="flex flex-col gap-2">
            {items.map((change, index) => (
              <li
                key={`${change.path}:${change.type}:${index}`}
                style={{ marginLeft: Math.min(depthForPath(change.path), 4) * 16 }}
                className={`rounded-lg border px-3 py-2 ${rowClasses(change.type)}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <code className="font-mono text-xs font-semibold break-all text-zinc-100">
                    {displayPath(change.path)}
                  </code>
                  <span
                    className={`rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium ${badgeClasses(change.type)}`}
                  >
                    {change.type}
                  </span>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="min-w-0 rounded bg-zinc-950/60 px-2 py-1.5">
                    <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
                      Old
                    </p>
                    <p className="mt-0.5 font-mono text-xs break-all text-zinc-300">
                      {formatValue(change.oldValue)}
                    </p>
                  </div>
                  <div className="min-w-0 rounded bg-zinc-950/60 px-2 py-1.5">
                    <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
                      New
                    </p>
                    <p className="mt-0.5 font-mono text-xs break-all text-zinc-300">
                      {formatValue(change.newValue)}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

export default function DiffResultPanel({
  result,
  isComputing = false,
  originalName = 'Original',
  modifiedName = 'Modified',
}: DiffResultPanelProps) {
  const [showUnchanged, setShowUnchanged] = useState(false)
  const [copyFeedback, setCopyFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [pdfFeedback, setPdfFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [exportingPdf, setExportingPdf] = useState(false)
  const feedbackTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current)
    }
  }, [])

  const flashFeedback = (
    setter: (value: { kind: 'ok' | 'error'; text: string } | null) => void,
    value: { kind: 'ok' | 'error'; text: string },
  ) => {
    setter(value)
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current)
    feedbackTimer.current = window.setTimeout(() => setter(null), 3000)
  }

  const counts = useMemo(() => {
    const changes = result?.changes ?? []
    return {
      added: changes.filter((c) => c.type === 'added').length,
      removed: changes.filter((c) => c.type === 'removed').length,
      modified: changes.filter((c) => c.type === 'modified').length,
      typeChanged: changes.filter((c) => c.type === 'type-changed').length,
      unchanged: changes.filter((c) => c.type === 'unchanged').length,
    }
  }, [result])

  const visibleChanges = useMemo(() => {
    if (!result) return []
    if (showUnchanged) return result.changes
    return result.changes.filter((c) => c.type !== 'unchanged')
  }, [result, showUnchanged])

  const isCsv = result?.pluginId === 'csv'

  const summaryLine = `${counts.added} added, ${counts.removed} removed, ${counts.modified} modified, ${counts.typeChanged} type changes${counts.unchanged > 0 ? `, ${counts.unchanged} unchanged` : ''}`

  const handleCopy = async () => {
    if (!result) return
    try {
      const patch = await toJsonPatch(result.changes)
      await copyTextToClipboard(JSON.stringify(patch, null, 2))
      flashFeedback(setCopyFeedback, {
        kind: 'ok',
        text: `Copied ${patch.length} patch operation${patch.length === 1 ? '' : 's'} to clipboard`,
      })
    } catch {
      flashFeedback(setCopyFeedback, { kind: 'error', text: 'Copy failed — clipboard unavailable' })
    }
  }

  const handlePdfExport = async () => {
    if (!result || exportingPdf) return
    setExportingPdf(true)
    try {
      const reportable = result.changes.filter((c) => c.type !== 'error')
      const title =
        result.pluginId === 'csv'
          ? 'CSV diff report'
          : result.pluginId === 'yaml'
            ? 'YAML diff report'
            : 'JSON diff report'
      const blob = await exportToPdf({
        title,
        originalName,
        modifiedName,
        summaryLine,
        changes: reportable.slice(0, MAX_PDF_ROWS).map((c) => ({
          path: c.path,
          type: c.type,
          oldValue: c.oldValue,
          newValue: c.newValue,
        })),
        truncatedCount: Math.max(0, reportable.length - MAX_PDF_ROWS),
      })
      downloadBlob(blob, `diffatlas-${result.pluginId}-report.pdf`)
      flashFeedback(setPdfFeedback, { kind: 'ok', text: 'PDF report downloaded' })
    } catch {
      flashFeedback(setPdfFeedback, { kind: 'error', text: 'PDF export failed in this browser' })
    } finally {
      setExportingPdf(false)
    }
  }

  return (
    <section className="min-h-48 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-6">
      {isComputing && !result ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Spinner label="Computing diff…" />
          <p className="max-w-md text-xs text-zinc-500">
            Crunching a large file in the background — the page stays interactive, and you can
            toggle options while you wait.
          </p>
        </div>
      ) : !result ? (
        <p className="text-sm text-zinc-500">
          Diff output will appear here once both files are loaded.
        </p>
      ) : result.status === 'error' ? (
        <div className="rounded-lg border border-red-800/60 bg-red-950/40 p-4">
          <p className="text-sm font-semibold text-red-200">Could not compute diff</p>
          <p className="mt-1 font-mono text-xs break-all text-red-300">
            {result.error ?? 'Invalid input.'}
          </p>
        </div>
      ) : result.status === 'not-implemented' ? (
        <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 p-4">
          <p className="text-sm font-semibold text-amber-200">Diff not available yet</p>
          <p className="mt-1 text-xs text-amber-200/80">
            Image diff has its own visual comparison view.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {isComputing && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-teal-800/60 bg-teal-950/30 px-3 py-2">
              <Spinner label="Updating diff…" />
              <span className="text-[11px] text-teal-200/70">Previous results stay interactive</span>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-zinc-400">
              {counts.added} added, {counts.removed} removed, {counts.modified} modified,{' '}
              {counts.typeChanged} type changes
              {counts.unchanged > 0 && `, ${counts.unchanged} unchanged`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-pressed={showUnchanged}
                onClick={() => setShowUnchanged((v) => !v)}
                className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  showUnchanged
                    ? 'border-teal-700 bg-teal-950/50 text-teal-200'
                    : 'border-zinc-700 bg-zinc-950/60 text-zinc-300 hover:border-zinc-500'
                }`}
              >
                Show unchanged fields: {showUnchanged ? 'On' : 'Off'}
              </button>
              <button
                type="button"
                onClick={handleCopy}
                className="rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-500"
              >
                Copy as JSON Patch
              </button>
              <button
                type="button"
                onClick={handlePdfExport}
                disabled={exportingPdf}
                className="rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-500 disabled:cursor-wait disabled:opacity-60"
              >
                {exportingPdf ? 'Exporting…' : 'Export Report (PDF)'}
              </button>
            </div>
          </div>
          {(copyFeedback ?? pdfFeedback) && (
            <p
              role="status"
              className={`rounded-md border px-3 py-2 text-xs ${
                (copyFeedback ?? pdfFeedback)?.kind === 'ok'
                  ? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-200'
                  : 'border-red-800/60 bg-red-950/40 text-red-200'
              }`}
            >
              {[copyFeedback, pdfFeedback]
                .filter((feedback) => feedback !== null)
                .map((feedback) => feedback.text)
                .join(' · ')}
            </p>
          )}

          {result.changes.length === 0 ? (
            <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/30 p-4 text-center">
              <p className="text-sm font-medium text-emerald-200">No differences found</p>
              <p className="mt-1 text-xs text-emerald-200/70">
                {isCsv
                  ? 'Both CSV files contain the same rows.'
                  : result.pluginId === 'yaml'
                    ? 'Both YAML documents are structurally identical.'
                    : 'Both JSON documents are structurally identical.'}
              </p>
            </div>
          ) : visibleChanges.length === 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4 text-center">
              <p className="text-sm font-medium text-zinc-300">No differences found</p>
              <p className="mt-1 text-xs text-zinc-500">
                {counts.unchanged} unchanged field{counts.unchanged === 1 ? '' : 's'} hidden —
                toggle “Show unchanged fields” to inspect them.
              </p>
            </div>
          ) : isCsv ? (
            <CsvTableView result={result} showUnchanged={showUnchanged} />
          ) : (
            <JsonTreeView changes={visibleChanges} />
          )}
        </div>
      )}
    </section>
  )
}
