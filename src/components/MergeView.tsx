import { useState } from 'react'
import FileInputPanel from './FileInputPanel.tsx'
import { JsonTreeView } from './DiffResultPanel.tsx'
import {
  setValueAtPath,
  threeWayMerge,
  type ConflictItem,
} from '../lib/merge/threeWayMerge.ts'
import { jsonPlugin } from '../lib/diff-engine/plugins/json.ts'
import type { DiffChange } from '../lib/diff-engine/core/types.ts'
import type { LoadedFile } from '../lib/diff-engine/core/types.ts'

type ResolutionChoice = 'left' | 'right' | 'manual'

interface Resolution {
  choice: ResolutionChoice
  manual: string
}

interface MergeOutput {
  mergedText: string
  appliedChanges: DiffChange[]
  conflicts: ConflictItem[]
}

function getJsonParseError(content: string): string | null {
  if (!content.trim()) return null
  try {
    JSON.parse(content)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid JSON'
  }
}

function previewValue(value: unknown): string {
  if (value === undefined) return '(deleted)'
  try {
    const text = JSON.stringify(value)
    if (text === undefined) return String(value)
    return text.length > 120 ? `${text.slice(0, 117)}…` : text
  } catch {
    return String(value)
  }
}

/** Manual input is parsed as JSON when possible, otherwise kept as a string. */
function parseManualValue(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return ''
  try {
    return JSON.parse(trimmed)
  } catch {
    return text
  }
}

function SideHint({ file, label }: { file: LoadedFile | null; label: string }) {
  if (file === null) {
    return (
      <p className="text-xs text-zinc-500">
        Add content to {label} — paste JSON or drop a file, then click Load file.
      </p>
    )
  }
  if (!file.content.trim()) {
    return <p className="text-xs text-zinc-500">{label} is empty — add JSON content to merge.</p>
  }
  const parseError = file.type === 'json' || file.type === 'unknown' ? getJsonParseError(file.content) : null
  if (parseError !== null) {
    return (
      <p role="alert" className="rounded-md border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-200">
        Invalid JSON in {label}: <span className="font-mono break-all">{parseError}</span>
      </p>
    )
  }
  if (file.type !== 'json') {
    return (
      <p role="alert" className="rounded-md border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-200">
        {label} detected as “{file.type}” — merge needs JSON on all three sides.
      </p>
    )
  }
  return null
}

export default function MergeView() {
  const [base, setBase] = useState<LoadedFile | null>(null)
  const [left, setLeft] = useState<LoadedFile | null>(null)
  const [right, setRight] = useState<LoadedFile | null>(null)
  const [output, setOutput] = useState<MergeOutput | null>(null)
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({})
  const [finalText, setFinalText] = useState<string | null>(null)

  const handleLoaded = (side: 'base' | 'left' | 'right', file: LoadedFile) => {
    if (side === 'base') setBase(file)
    else if (side === 'left') setLeft(file)
    else setRight(file)
    setOutput(null)
    setFinalText(null)
  }

  const sideReady = (file: LoadedFile | null): boolean =>
    !!file && !!file.content.trim() && file.type === 'json' && getJsonParseError(file.content) === null
  const canMerge = sideReady(base) && sideReady(left) && sideReady(right)

  const handleMerge = () => {
    if (!base || !left || !right) return
    const baseValue = JSON.parse(base.content) as object
    const leftValue = JSON.parse(left.content) as object
    const rightValue = JSON.parse(right.content) as object
    const { merged, conflicts } = threeWayMerge(baseValue, leftValue, rightValue)
    const mergedText = JSON.stringify(merged, null, 2)
    const appliedChanges = jsonPlugin.diff(base.content, JSON.stringify(merged)).changes
    const initial: Record<string, Resolution> = {}
    for (const conflict of conflicts) {
      initial[conflict.path] = { choice: 'left', manual: previewValue(conflict.leftValue) }
    }
    setResolutions(initial)
    setFinalText(null)
    setOutput({ mergedText, appliedChanges, conflicts })
  }

  const handleApply = () => {
    if (!output) return
    let finalValue: unknown = JSON.parse(output.mergedText) as object
    for (const conflict of output.conflicts) {
      const resolution = resolutions[conflict.path] ?? { choice: 'left' as const, manual: '' }
      const value =
        resolution.choice === 'left'
          ? conflict.leftValue
          : resolution.choice === 'right'
            ? conflict.rightValue
            : parseManualValue(resolution.manual)
      if (conflict.path === '') {
        finalValue = value
      } else {
        setValueAtPath(finalValue as object, conflict.path, value)
      }
    }
    setFinalText(JSON.stringify(finalValue, null, 2))
  }

  const handleDownload = () => {
    if (!finalText) return
    const blob = new Blob([finalText], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'merged.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-2">
          <FileInputPanel label="Base" onFileLoaded={(file) => handleLoaded('base', file)} />
          <SideHint file={base} label="Base" />
        </div>
        <div className="flex flex-col gap-2">
          <FileInputPanel label="Left (yours)" onFileLoaded={(file) => handleLoaded('left', file)} />
          <SideHint file={left} label="Left" />
        </div>
        <div className="flex flex-col gap-2">
          <FileInputPanel label="Right (theirs)" onFileLoaded={(file) => handleLoaded('right', file)} />
          <SideHint file={right} label="Right" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!canMerge}
          onClick={handleMerge}
          className="rounded-md bg-teal-600 px-5 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          Merge
        </button>
        {!canMerge && (
          <p className="text-xs text-zinc-500">Load valid JSON on all three sides to merge.</p>
        )}
      </div>

      {output && (
        <div className="flex flex-col gap-6">
          <p className="text-xs text-zinc-400">
            {output.appliedChanges.length} auto-merged change
            {output.appliedChanges.length === 1 ? '' : 's'}
            {output.conflicts.length > 0 && (
              <>
                {', '}
                <span className="font-semibold text-red-300">
                  {output.conflicts.length} conflict{output.conflicts.length === 1 ? '' : 's'}
                </span>
              </>
            )}
            {output.conflicts.length === 0 && (
              <span className="font-semibold text-emerald-300"> — clean merge, no conflicts</span>
            )}
          </p>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
            <h2 className="text-sm font-semibold text-zinc-200">Auto-merged result</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Changes vs base (conflicted paths keep the base value until resolved).
            </p>
            <div className="mt-4">
              {output.appliedChanges.length === 0 ? (
                <p className="text-sm text-zinc-500">Merged result is identical to base.</p>
              ) : (
                <JsonTreeView changes={output.appliedChanges} />
              )}
            </div>
          </section>

          {output.conflicts.length > 0 && (
            <section className="flex flex-col gap-3 rounded-xl border border-red-800/50 bg-red-950/20 p-6">
              <h2 className="text-sm font-semibold text-red-200">
                Conflicts ({output.conflicts.length})
              </h2>
              <ul className="flex flex-col gap-4">
                {output.conflicts.map((conflict, index) => {
                  const resolution = resolutions[conflict.path] ?? { choice: 'left', manual: '' }
                  const radioName = `conflict-${index}`
                  return (
                    <li
                      key={conflict.path || '(root)'}
                      className="rounded-lg border border-red-800/50 bg-zinc-950/60 p-4"
                    >
                      <code className="font-mono text-xs font-semibold break-all text-zinc-100">
                        {conflict.path || '(root)'}
                      </code>
                      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                        <div className="rounded bg-zinc-900/80 px-2 py-1.5">
                          <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">Base</p>
                          <p className="mt-0.5 font-mono break-all text-zinc-400">{previewValue(conflict.baseValue)}</p>
                        </div>
                        <div className="rounded bg-zinc-900/80 px-2 py-1.5">
                          <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">Left (yours)</p>
                          <p className="mt-0.5 font-mono break-all text-emerald-200">{previewValue(conflict.leftValue)}</p>
                        </div>
                        <div className="rounded bg-zinc-900/80 px-2 py-1.5">
                          <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">Right (theirs)</p>
                          <p className="mt-0.5 font-mono break-all text-sky-200">{previewValue(conflict.rightValue)}</p>
                        </div>
                      </div>
                      <fieldset className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-300">
                        <legend className="sr-only">
                          Resolution for {conflict.path || 'root conflict'}
                        </legend>
                        <label className="flex min-h-[44px] items-center gap-1.5 md:min-h-0">
                          <input
                            type="radio"
                            name={radioName}
                            value="left"
                            checked={resolution.choice === 'left'}
                            onChange={() => setResolutions((prev) => ({ ...prev, [conflict.path]: { ...resolution, choice: 'left' } }))}
                            className="accent-teal-500"
                          />
                          Use Left
                        </label>
                        <label className="flex min-h-[44px] items-center gap-1.5 md:min-h-0">
                          <input
                            type="radio"
                            name={radioName}
                            value="right"
                            checked={resolution.choice === 'right'}
                            onChange={() => setResolutions((prev) => ({ ...prev, [conflict.path]: { ...resolution, choice: 'right' } }))}
                            className="accent-teal-500"
                          />
                          Use Right
                        </label>
                        <label className="flex min-h-[44px] items-center gap-1.5 md:min-h-0">
                          <input
                            type="radio"
                            name={radioName}
                            value="manual"
                            checked={resolution.choice === 'manual'}
                            onChange={() => setResolutions((prev) => ({ ...prev, [conflict.path]: { ...resolution, choice: 'manual' } }))}
                            className="accent-teal-500"
                          />
                          Edit manually
                        </label>
                      </fieldset>
                      {resolution.choice === 'manual' && (
                        <input
                          type="text"
                          value={resolution.manual}
                          onChange={(event) =>
                            setResolutions((prev) => ({
                              ...prev,
                              [conflict.path]: { ...resolution, manual: event.target.value },
                            }))
                          }
                          placeholder='Replacement JSON value, e.g. "custom" or 42'
                          spellCheck={false}
                          aria-label={`Manual value for ${conflict.path || '(root)'}`}
                          className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950/80 px-2.5 py-1.5 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-teal-700 focus:outline-none"
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
              <div>
                <button
                  type="button"
                  onClick={handleApply}
                  className="rounded-md bg-teal-600 px-4 py-1.5 text-xs font-semibold text-zinc-950 transition-colors hover:bg-teal-500"
                >
                  Apply Resolutions
                </button>
              </div>
            </section>
          )}

          {finalText && (
            <section className="rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-emerald-200">Final merged JSON</h2>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="rounded-md border border-emerald-700/60 bg-emerald-950/50 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-900/50"
                >
                  Download merged.json
                </button>
              </div>
              <pre className="mt-3 max-h-96 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 font-mono text-xs text-zinc-300">
                {finalText}
              </pre>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
