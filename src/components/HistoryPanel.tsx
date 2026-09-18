import { canReloadHistory } from '../lib/share/history.ts'
import type { RecentDiff } from '../lib/storage/indexedDb.ts'

interface HistoryPanelProps {
  entries: RecentDiff[]
  onReload: (entry: RecentDiff) => void
  onClear: () => void
}

function formatTime(createdAt: number): string {
  try {
    return new Date(createdAt).toLocaleString()
  } catch {
    return 'Unknown time'
  }
}

export default function HistoryPanel({ entries, onReload, onClear }: HistoryPanelProps) {
  return (
    <section aria-label="Diff history" className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-200">
          History{' '}
          <span className="font-normal text-zinc-500">
            ({entries.length} recent diff{entries.length === 1 ? '' : 's'}, stored locally)
          </span>
        </h2>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-red-700 hover:text-red-200"
          >
            Clear History
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="mt-3 text-xs text-zinc-500">
          Successful diffs will appear here. History never leaves this browser.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {entries.map((entry) => {
            const reloadable = canReloadHistory(entry)
            const originalName = entry.original.name ?? 'Original'
            const modifiedName = entry.modified.name ?? 'Modified'
            return (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-zinc-200">
                    {originalName} <span className="text-zinc-600">→</span> {modifiedName}
                  </p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    {formatTime(entry.createdAt)} · {entry.original.type} + {entry.modified.type}
                    {entry.summaryLine ? ` · ${entry.summaryLine}` : ''}
                  </p>
                  {!reloadable && (
                    <p className="mt-0.5 text-[11px] text-amber-200/80">
                      Content too large to keep — stored as reference only.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!reloadable}
                  onClick={() => onReload(entry)}
                  title={reloadable ? 'Load this diff back into the panels' : 'Content was too large to store'}
                  className="shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-teal-700 hover:text-teal-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-zinc-700 disabled:hover:text-zinc-300"
                >
                  Reload
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
