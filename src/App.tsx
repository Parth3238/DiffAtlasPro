import { useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import Header from './components/Header.tsx'
import FileInputPanel from './components/FileInputPanel.tsx'
import DiffResultPanel from './components/DiffResultPanel.tsx'
import HistoryPanel from './components/HistoryPanel.tsx'
import ImageDiffView from './components/ImageDiffView.tsx'
import MergeView from './components/MergeView.tsx'
import { useDiffWorker } from './hooks/useDiffWorker.ts'
import { decodeShareHash, encodeShareLink } from './lib/share/shareLinks.ts'
import { buildHistoryRecord, formatHistorySummary, historySignature } from './lib/share/history.ts'
import {
  clearRecentDiffs,
  listRecentDiffs,
  saveRecentDiff,
  type RecentDiff,
} from './lib/storage/indexedDb.ts'
import type { LoadedFile } from './lib/diff-engine/core/types.ts'

function getJsonParseError(content: string): string | null {
  if (!content.trim()) return null
  try {
    JSON.parse(content)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid JSON'
  }
}

function getCsvHeaders(content: string): string[] | null {
  if (!content.trim()) return null
  try {
    const parsed = Papa.parse(content, { header: true, skipEmptyLines: 'greedy', preview: 1 })
    const fields = parsed.meta.fields ?? []
    return fields.length > 0 ? fields : null
  } catch {
    return null
  }
}

interface DiffRequest {
  fileType: string
  original: string
  modified: string
}

interface PanelSeed {
  nonce: number
  original: { content: string; filename: string }
  modified: { content: string; filename: string }
}

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

export default function App() {
  const [mode, setMode] = useState<'diff' | 'merge'>('diff')
  const [original, setOriginal] = useState<LoadedFile | null>(null)
  const [modified, setModified] = useState<LoadedFile | null>(null)
  const [panelSeed, setPanelSeed] = useState<PanelSeed | null>(null)
  const [history, setHistory] = useState<RecentDiff[]>([])
  const [shareFeedback, setShareFeedback] = useState<string | null>(null)
  const [hashError, setHashError] = useState<string | null>(null)
  const lastSavedSignature = useRef<string | null>(null)
  const { runDiff, result: workerResult, isComputing, error: workerError } = useDiffWorker()

  const handleFileLoaded = (side: 'original' | 'modified', file: LoadedFile) => {
    if (side === 'original') setOriginal(file)
    else setModified(file)
  }

  // Boot: restore a shared diff from the URL hash and load local history.
  useEffect(() => {
    void listRecentDiffs()
      .then(setHistory)
      .catch(() => {})
    const hash = window.location.hash
    if (hash.startsWith('#d=')) {
      const payload = decodeShareHash(hash)
      if (payload) {
        setPanelSeed({
          nonce: Date.now(),
          original: { content: payload.contentA, filename: payload.nameA ?? '' },
          modified: { content: payload.contentB, filename: payload.nameB ?? '' },
        })
      } else {
        setHashError('This share link is invalid or corrupted — load files manually instead.')
      }
    }
  }, [])

  const refreshHistory = () => {
    void listRecentDiffs()
      .then(setHistory)
      .catch(() => {})
  }

  const persistHistory = (first: LoadedFile, second: LoadedFile, summaryLine: string) => {
    const signature = historySignature(first, second)
    if (lastSavedSignature.current === signature) return
    lastSavedSignature.current = signature
    void saveRecentDiff(buildHistoryRecord(first, second, summaryLine))
      .then(refreshHistory)
      .catch(() => {})
  }

  const originalParseError = useMemo(
    () => (original ? getJsonParseError(original.content) : null),
    [original],
  )
  const modifiedParseError = useMemo(
    () => (modified ? getJsonParseError(modified.content) : null),
    [modified],
  )

  const originalEmpty = !original || !original.content.trim()
  const modifiedEmpty = !modified || !modified.content.trim()
  const originalInvalidJson =
    !originalEmpty && originalParseError !== null && (original?.type === 'json' || original?.type === 'unknown')
  const modifiedInvalidJson =
    !modifiedEmpty && modifiedParseError !== null && (modified?.type === 'json' || modified?.type === 'unknown')

  const bothLoaded = !originalEmpty && !modifiedEmpty && original !== null && modified !== null
  const typesMatch = bothLoaded && original.type === modified.type
  const typeMismatch =
    bothLoaded && !originalInvalidJson && !modifiedInvalidJson && original.type !== modified.type

  // Route to the matching plugin: JSON -> tree view, CSV -> table view (via
  // result.pluginId in DiffResultPanel). Image pairs bypass the worker and
  // render in ImageDiffView instead; mismatched or unknown types never attempt
  // a diff. Computation runs in a Web Worker via useDiffWorker so the UI stays
  // responsive on large files.
  const diffRequest = useMemo<DiffRequest | null>(() => {
    if (!original || !modified) return null
    if (!original.content.trim() || !modified.content.trim()) return null
    if (original.type !== modified.type) return null

    if (original.type === 'json') {
      if (getJsonParseError(original.content) !== null) return null
      if (getJsonParseError(modified.content) !== null) return null
      return { fileType: 'json', original: original.content, modified: modified.content }
    }
    if (original.type === 'csv') {
      // Malformed CSV surfaces as an error DiffResult from the engine, and
      // differing column sets are handled best-effort with a warning below.
      return { fileType: 'csv', original: original.content, modified: modified.content }
    }
    if (original.type === 'yaml') {
      // Malformed YAML likewise surfaces as an engine error DiffResult.
      return { fileType: 'yaml', original: original.content, modified: modified.content }
    }
    return null
  }, [original, modified])

  // Image pairs take the visual path: both sides need decodable payloads.
  const imagePair =
    original !== null &&
    modified !== null &&
    !originalEmpty &&
    !modifiedEmpty &&
    original.type === 'image' &&
    modified.type === 'image'
      ? { original, modified }
      : null
  const imageUrls =
    imagePair?.original.dataUrl && imagePair?.modified.dataUrl
      ? { originalUrl: imagePair.original.dataUrl, modifiedUrl: imagePair.modified.dataUrl }
      : null

  useEffect(() => {
    if (diffRequest) {
      runDiff(diffRequest.fileType, diffRequest.original, diffRequest.modified)
    }
  }, [diffRequest, runDiff])

  // Hide stale worker output as soon as the inputs stop describing a diffable pair.
  const result = diffRequest ? workerResult : null

  // After each successful worker diff, save a lightweight history record.
  useEffect(() => {
    if (!diffRequest || !workerResult || workerResult.status !== 'ok') return
    if (!original || !modified) return
    const changes = workerResult.changes
    const count = (type: string) => changes.filter((c) => c.type === type).length
    persistHistory(
      original,
      modified,
      formatHistorySummary({
        added: count('added'),
        removed: count('removed'),
        modified: count('modified'),
        typeChanged: count('type-changed'),
        unchanged: count('unchanged'),
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffRequest, workerResult, original, modified])

  // Image pairs bypass the worker, so their history record is saved here.
  const imageContentA = imagePair?.original.content ?? null
  const imageContentB = imagePair?.modified.content ?? null
  useEffect(() => {
    if (!imagePair || imageContentA === null || imageContentB === null) return
    persistHistory(imagePair.original, imagePair.modified, 'Image visual comparison')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageContentA, imageContentB])

  const handleHistoryReload = (entry: RecentDiff) => {
    setPanelSeed({
      nonce: Date.now(),
      original: { content: entry.original.content, filename: entry.original.name ?? '' },
      modified: { content: entry.modified.content, filename: entry.modified.name ?? '' },
    })
    const encoded = encodeShareLink({
      v: 1,
      fileTypeA: entry.original.type,
      contentA: entry.original.content,
      fileTypeB: entry.modified.type,
      contentB: entry.modified.content,
      nameA: entry.original.name,
      nameB: entry.modified.name,
    })
    if ('url' in encoded) {
      window.location.hash = encoded.url.slice(encoded.url.indexOf('#'))
    }
  }

  const handleHistoryClear = () => {
    void clearRecentDiffs()
      .then(() => setHistory([]))
      .catch(() => {})
  }

  const handleShare = async () => {
    if (!original || !modified) return
    const encoded = encodeShareLink({
      v: 1,
      fileTypeA: original.type,
      contentA: original.content,
      fileTypeB: modified.type,
      contentB: modified.content,
      nameA: original.name,
      nameB: modified.name,
    })
    if ('error' in encoded) {
      setShareFeedback('File too large for a shareable link, use export instead')
      return
    }
    try {
      await copyTextToClipboard(encoded.url)
      window.location.hash = encoded.url.slice(encoded.url.indexOf('#'))
      setShareFeedback('Shareable link copied to clipboard')
    } catch {
      setShareFeedback('Copy failed — copy the URL from the address bar')
    }
  }

  const shareablePair =
    original !== null &&
    modified !== null &&
    !originalEmpty &&
    !modifiedEmpty &&
    original.type === modified.type &&
    (original.type === 'json' ||
      original.type === 'yaml' ||
      original.type === 'csv' ||
      original.type === 'image')

  // Best-effort notice when the two CSVs do not share the same columns.
  const columnWarning = useMemo(() => {
    if (!bothLoaded || !typesMatch || original?.type !== 'csv' || modified === null || original === null) {
      return null
    }
    const headersA = getCsvHeaders(original.content)
    const headersB = getCsvHeaders(modified.content)
    if (!headersA || !headersB) return null
    const setA = new Set(headersA)
    const setB = new Set(headersB)
    const added = headersB.filter((h) => !setA.has(h))
    const removed = headersA.filter((h) => !setB.has(h))
    if (added.length === 0 && removed.length === 0) return null
    return { added, removed }
  }, [bothLoaded, typesMatch, original, modified])

  return (
    <main className="mx-auto min-h-dvh max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <Header />

      <div role="tablist" aria-label="Mode" className="mt-6 flex gap-2">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'diff'}
          onClick={() => setMode('diff')}
          className={`rounded-md border px-4 py-1.5 text-xs font-semibold transition-colors ${
            mode === 'diff'
              ? 'border-teal-700 bg-teal-950/50 text-teal-200'
              : 'border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
          }`}
        >
          Diff Mode
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'merge'}
          onClick={() => setMode('merge')}
          className={`rounded-md border px-4 py-1.5 text-xs font-semibold transition-colors ${
            mode === 'merge'
              ? 'border-teal-700 bg-teal-950/50 text-teal-200'
              : 'border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
          }`}
        >
          Merge Mode
        </button>
      </div>

      {mode === 'merge' ? (
        <div className="mt-8">
          <MergeView />
        </div>
      ) : (
        <>
          <div className="mt-8 grid items-start gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <FileInputPanel
            key={panelSeed ? `original-${panelSeed.nonce}` : 'original'}
            label="Original"
            initialContent={panelSeed?.original.content}
            initialFilename={panelSeed?.original.filename}
            onFileLoaded={(file) => handleFileLoaded('original', file)}
          />
          {original === null ? (
            <p className="text-xs text-zinc-500">
              Add content to Original — paste JSON, YAML, or CSV \u2014 or drop a file, then click Load file.
            </p>
          ) : originalEmpty ? (
            <p className="text-xs text-zinc-500">
              Original is empty — add content to compare.
            </p>
          ) : originalInvalidJson ? (
            <p role="alert" className="rounded-md border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-200">
              Invalid JSON in Original: <span className="font-mono break-all">{originalParseError}</span>
            </p>
          ) : original.type === 'unknown' ? (
            <p role="alert" className="rounded-md border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-200">
              Could not detect Original as JSON, YAML, or CSV — check the syntax and load again.
            </p>
          ) : original.type === 'image' ? (
            <p className="rounded-md border border-teal-800/60 bg-teal-950/30 px-3 py-2 text-xs text-teal-200">
              Original detected as “image” — visual comparison appears below.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <FileInputPanel
            key={panelSeed ? `modified-${panelSeed.nonce}` : 'modified'}
            label="Modified"
            initialContent={panelSeed?.modified.content}
            initialFilename={panelSeed?.modified.filename}
            onFileLoaded={(file) => handleFileLoaded('modified', file)}
          />
          {modified === null ? (
            <p className="text-xs text-zinc-500">
              Add content to Modified — paste JSON, YAML, or CSV \u2014 or drop a file, then click Load file.
            </p>
          ) : modifiedEmpty ? (
            <p className="text-xs text-zinc-500">
              Modified is empty — add content to compare.
            </p>
          ) : modifiedInvalidJson ? (
            <p role="alert" className="rounded-md border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-200">
              Invalid JSON in Modified: <span className="font-mono break-all">{modifiedParseError}</span>
            </p>
          ) : modified.type === 'unknown' ? (
            <p role="alert" className="rounded-md border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-200">
              Could not detect Modified as JSON, YAML, or CSV — check the syntax and load again.
            </p>
          ) : modified.type === 'image' ? (
            <p className="rounded-md border border-teal-800/60 bg-teal-950/30 px-3 py-2 text-xs text-teal-200">
              Modified detected as “image” — visual comparison appears below.
            </p>
          ) : null}
        </div>
      </div>

      {hashError && (
        <p role="alert" className="mt-4 rounded-md border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-200">
          {hashError}
        </p>
      )}

      {typeMismatch && original && modified && (
        <p className="mt-4 rounded-md border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          Type mismatch: Original is “{original.type}” but Modified is “{modified.type}” — load the
          same type on both sides (JSON + JSON, YAML + YAML, CSV + CSV, or image + image) to diff.
        </p>
      )}

      {columnWarning && (
        <p className="mt-4 rounded-md border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          Columns differ — showing a best-effort diff.
          {columnWarning.added.length > 0 && (
            <> Added: <span className="font-mono">{columnWarning.added.join(', ')}</span>.</>
          )}{' '}
          {columnWarning.removed.length > 0 && (
            <> Removed: <span className="font-mono">{columnWarning.removed.join(', ')}</span>.</>
          )}
        </p>
      )}

      {shareablePair && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleShare}
            className="rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-500"
          >
            Copy Shareable Link
          </button>
          {shareFeedback && (
            <p role="status" className="text-xs text-zinc-400">
              {shareFeedback}
            </p>
          )}
        </div>
      )}

      <div className="mt-6">
        {imagePair ? (
          imageUrls ? (
            <ImageDiffView
              originalUrl={imageUrls.originalUrl}
              modifiedUrl={imageUrls.modifiedUrl}
              originalName={original?.name ?? 'Original image'}
              modifiedName={modified?.name ?? 'Modified image'}
            />
          ) : (
            <p className="rounded-xl border border-amber-700/60 bg-amber-950/30 p-6 text-xs text-amber-200">
              Both sides detected as images, but at least one is inline text (e.g. pasted SVG
              markup) rather than an image file. Drop PNG/JPEG files on both panels to compare
              them visually.
            </p>
          )
        ) : (
          <DiffResultPanel
            result={result}
            isComputing={isComputing}
            originalName={original?.name ?? 'Original'}
            modifiedName={modified?.name ?? 'Modified'}
          />
        )}
      </div>

      {workerError && diffRequest && (
        <p role="alert" className="mt-4 rounded-md border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-200">
          Diff worker error: {workerError}
        </p>
      )}

      <div className="mt-6">
        <HistoryPanel entries={history} onReload={handleHistoryReload} onClear={handleHistoryClear} />
      </div>
        </>
      )}

      <footer className="mt-10 pb-4 text-center text-xs text-zinc-600">
        No backend · No API keys · Your files never leave the browser
      </footer>
    </main>
  )
}
