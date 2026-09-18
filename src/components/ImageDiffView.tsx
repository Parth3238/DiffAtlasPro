import { useEffect, useRef, useState } from 'react'
import {
  computeMatchedSize,
  diffImageData,
  type ChangedRegion,
  type MatchedSize,
  type RgbaBuffer,
} from '../lib/diff-engine/plugins/image.ts'
import { downloadBlob, exportToPdf } from '../lib/export/pdfExport.ts'

interface ImageDiffViewProps {
  originalUrl: string
  modifiedUrl: string
  originalName?: string
  modifiedName?: string
}

type ViewMode = 'side' | 'overlay' | 'mask'
type Status = 'loading' | 'ready' | 'error'

interface Summary {
  percentChanged: number
  changedBlockCount: number
  totalBlocks: number
  changedPixelCount: number
  regionCount: number
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode image — try a PNG or JPEG file'))
    img.src = url
  })
}

/**
 * Yields to the event loop so the loading UI paints before the (tight,
 * typed-array) pixel loop runs. requestIdleCallback when available, otherwise
 * a macrotask — the lighter alternative to a worker for this workload, since
 * image decode itself already happens off the main thread.
 */
function yieldToUI(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void
    }).requestIdleCallback
    if (ric) ric(() => resolve(), { timeout: 100 })
    else window.setTimeout(() => resolve(), 0)
  })
}

function drawScaled(img: HTMLImageElement, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is not available in this browser')
  ctx.drawImage(img, 0, 0, width, height)
  return canvas
}

function readPixels(canvas: HTMLCanvasElement): RgbaBuffer {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is not available in this browser')
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { data: imageData.data, width: canvas.width, height: canvas.height }
}

function paintInto(target: HTMLCanvasElement | null, source: HTMLCanvasElement): void {
  if (!target) return
  target.width = source.width
  target.height = source.height
  const ctx = target.getContext('2d')
  ctx?.drawImage(source, 0, 0)
}

const MODE_TABS: { id: ViewMode; label: string }[] = [
  { id: 'side', label: 'Side-by-side' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'mask', label: 'Diff mask' },
]

export default function ImageDiffView({
  originalUrl,
  modifiedUrl,
  originalName = 'Original image',
  modifiedName = 'Modified image',
}: ImageDiffViewProps) {
  const [status, setStatus] = useState<Status>('loading')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [matched, setMatched] = useState<MatchedSize | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [regions, setRegions] = useState<ChangedRegion[]>([])
  const [mode, setMode] = useState<ViewMode>('side')
  const [blend, setBlend] = useState(50)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [exportingPdf, setExportingPdf] = useState(false)

  const origRef = useRef<HTMLCanvasElement>(null)
  const modRef = useRef<HTMLCanvasElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const topRef = useRef<HTMLCanvasElement>(null)
  const maskRef = useRef<HTMLCanvasElement>(null)

  const summaryText = (): string | null => {
    if (!summary || !matched) return null
    return (
      `${summary.percentChanged.toFixed(2)}% of image changed ` +
      `(${summary.changedBlockCount} of ${summary.totalBlocks} blocks, ` +
      `${summary.regionCount} region${summary.regionCount === 1 ? '' : 's'}, ` +
      `${summary.changedPixelCount.toLocaleString()} pixels, ` +
      `${matched.width}x${matched.height})`
    )
  }

  const handleCopySummary = async () => {
    const text = summaryText()
    if (!text) return
    try {
      const full = `Image diff — ${originalName} vs ${modifiedName}: ${text}`
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(full)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = full
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        const ok = document.execCommand('copy')
        textarea.remove()
        if (!ok) throw new Error('clipboard unavailable')
      }
      setFeedback({ kind: 'ok', text: 'Summary copied to clipboard' })
    } catch {
      setFeedback({ kind: 'error', text: 'Copy failed — clipboard unavailable' })
    }
  }

  const handlePdfExport = async () => {
    if (!summary || !matched || exportingPdf) return
    setExportingPdf(true)
    try {
      const maskDataUrl = maskRef.current?.toDataURL('image/png')
      const caption = `${summary.percentChanged.toFixed(2)}% of image changed across ` +
        `${summary.regionCount} region${summary.regionCount === 1 ? '' : 's'} ` +
        `(${matched.width}x${matched.height}).`
      const blob = await exportToPdf({
        title: 'Image diff report',
        originalName,
        modifiedName,
        summaryLine: caption,
        changes: regions.map((region, index) => ({
          path: `region[${index}]`,
          type: 'modified',
          oldValue: '—',
          newValue: `${region.x}, ${region.y}, ${region.width}x${region.height}`,
        })),
        notes: matched.resized
          ? [
              `Sizes differed (${matched.originalWidth}x${matched.originalHeight} vs ` +
              `${matched.modifiedWidth}x${matched.modifiedHeight}); larger resized to ` +
              `${matched.width}x${matched.height}.`,
            ]
          : undefined,
        imageDataUrl: maskDataUrl,
        imageCaption: caption,
      })
      downloadBlob(blob, 'diffatlas-image-report.pdf')
      setFeedback({ kind: 'ok', text: 'PDF report downloaded' })
    } catch {
      setFeedback({ kind: 'error', text: 'PDF export failed in this browser' })
    } finally {
      setExportingPdf(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setProgress(0)
    setError(null)
    setMatched(null)
    setSummary(null)
    setRegions([])
    setFeedback(null)

    const run = async () => {
      try {
        setProgress(5)
        const [imgA, imgB] = await Promise.all([loadImage(originalUrl), loadImage(modifiedUrl)])
        if (cancelled) return
        if (!imgA.naturalWidth || !imgA.naturalHeight || !imgB.naturalWidth || !imgB.naturalHeight) {
          throw new Error('Could not read image dimensions — try a PNG or JPEG file')
        }
        const size = computeMatchedSize(
          imgA.naturalWidth,
          imgA.naturalHeight,
          imgB.naturalWidth,
          imgB.naturalHeight,
        )
        setMatched(size)
        setProgress(25)
        await yieldToUI()
        if (cancelled) return

        const canvasA = drawScaled(imgA, size.width, size.height)
        const canvasB = drawScaled(imgB, size.width, size.height)
        const pixelsA = readPixels(canvasA)
        const pixelsB = readPixels(canvasB)
        setProgress(45)
        await yieldToUI()
        if (cancelled) return

        const diff = diffImageData(pixelsA, pixelsB)
        if (cancelled) return
        setProgress(80)

        paintInto(origRef.current, canvasA)
        paintInto(modRef.current, canvasB)
        paintInto(baseRef.current, canvasA)
        paintInto(topRef.current, canvasB)

        const maskCanvas = maskRef.current
        if (maskCanvas) {
          maskCanvas.width = size.width
          maskCanvas.height = size.height
          const ctx = maskCanvas.getContext('2d')
          if (ctx) {
            const out = ctx.createImageData(size.width, size.height)
            for (let i = 0; i < size.width * size.height; i++) {
              const offset = i * 4
              if (diff.mask[i] === 1) {
                out.data[offset] = 255
                out.data[offset + 1] = 0
                out.data[offset + 2] = 255
                out.data[offset + 3] = 255
              } else {
                const grey = Math.round(
                  0.299 * pixelsA.data[offset] +
                    0.587 * pixelsA.data[offset + 1] +
                    0.114 * pixelsA.data[offset + 2],
                )
                out.data[offset] = grey
                out.data[offset + 1] = grey
                out.data[offset + 2] = grey
                out.data[offset + 3] = 255
              }
            }
            ctx.putImageData(out, 0, 0)
            ctx.strokeStyle = '#ff00ff'
            ctx.lineWidth = Math.max(2, Math.round(size.width / 400))
            for (const region of diff.regions) {
              ctx.strokeRect(region.x, region.y, region.width, region.height)
            }
          }
        }

        if (cancelled) return
        setSummary({
          percentChanged: diff.percentChanged,
          changedBlockCount: diff.changedBlockCount,
          totalBlocks: diff.blockCols * diff.blockRows,
          changedPixelCount: diff.changedPixelCount,
          regionCount: diff.regions.length,
        })
        setRegions(diff.regions)
        setProgress(100)
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Image diff failed')
        setStatus('error')
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [originalUrl, modifiedUrl])

  return (
    <section className="min-h-48 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-6">
      {status === 'loading' && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-zinc-300">Comparing images… {Math.round(progress)}%</p>
          <div className="h-1.5 w-64 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-teal-500 transition-all"
              style={{ width: `${Math.round(progress)}%` }}
            />
          </div>
          <p className="max-w-md text-xs text-zinc-500">
            Decoding and diffing off the critical path — the page stays interactive.
          </p>
        </div>
      )}

      {status === 'error' && (
        <div className="rounded-lg border border-red-800/60 bg-red-950/40 p-4">
          <p className="text-sm font-semibold text-red-200">Could not compare images</p>
          <p className="mt-1 text-xs text-red-300">{error ?? 'Unknown error.'}</p>
        </div>
      )}

      {status === 'ready' && summary && matched && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-zinc-400">
              <span className="text-base font-semibold text-zinc-100">
                {summary.percentChanged.toFixed(2)}%
              </span>{' '}
              of image changed
              <span className="text-zinc-500">
                {' '}
                · {summary.changedBlockCount} of {summary.totalBlocks} blocks ·{' '}
                {summary.regionCount} region{summary.regionCount === 1 ? '' : 's'} ·{' '}
                {summary.changedPixelCount.toLocaleString()} pixels
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Image view mode">
                {MODE_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={mode === tab.id}
                    onClick={() => setMode(tab.id)}
                    className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      mode === tab.id
                        ? 'border-teal-700 bg-teal-950/50 text-teal-200'
                        : 'border-zinc-700 bg-zinc-950/60 text-zinc-300 hover:border-zinc-500'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={handleCopySummary}
                className="rounded-md border border-zinc-700 bg-zinc-950/60 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-500"
              >
                Copy summary
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

          {feedback && (
            <p
              role="status"
              className={`rounded-md border px-3 py-2 text-xs ${
                feedback.kind === 'ok'
                  ? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-200'
                  : 'border-red-800/60 bg-red-950/40 text-red-200'
              }`}
            >
              {feedback.text}
            </p>
          )}

          {matched.resized && (
            <p className="rounded-md border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
              Sizes differed ({matched.originalWidth}×{matched.originalHeight} vs{' '}
              {matched.modifiedWidth}×{matched.modifiedHeight}) — the larger image was resized to{' '}
              {matched.width}×{matched.height} for comparison.
            </p>
          )}

          {/*
            All three canvases stay mounted (inactive modes are hidden) so the
            one-shot paint after diffing lands on every surface and mode
            switches are instant.
          */}
          <div className={mode === 'side' ? 'grid gap-4 md:grid-cols-2' : 'hidden'}>
            <figure className="flex flex-col gap-1">
              <figcaption className="text-xs font-medium tracking-wide text-zinc-400 uppercase">
                Original
              </figcaption>
                <canvas ref={origRef} role="img" aria-label="Original image" className="h-auto max-w-full rounded-lg border border-zinc-800" />
            </figure>
            <figure className="flex flex-col gap-1">
              <figcaption className="text-xs font-medium tracking-wide text-zinc-400 uppercase">
                Modified
              </figcaption>
                <canvas ref={modRef} role="img" aria-label="Modified image" className="h-auto max-w-full rounded-lg border border-zinc-800" />
            </figure>
          </div>

          <div className={mode === 'overlay' ? 'flex flex-col gap-3' : 'hidden'}>
            <div className="relative mx-auto w-fit max-w-full">
                <canvas ref={baseRef} role="img" aria-label="Original image, overlay base layer" className="block h-auto max-w-full rounded-lg border border-zinc-800" />
                <canvas
                  ref={topRef}
                  role="img"
                  aria-label="Modified image, overlay blend layer"
                  className="absolute inset-0 h-full w-full rounded-lg"
                  style={{ opacity: blend / 100 }}
                />
            </div>
            <label className="flex items-center gap-3 text-xs text-zinc-400">
              <span className="shrink-0">Original</span>
              <input
                type="range"
                min={0}
                max={100}
                value={blend}
                onChange={(e) => setBlend(Number(e.target.value))}
                aria-label="Blend between original and modified"
                  className="h-11 w-full max-w-md accent-teal-500 md:h-auto"
              />
              <span className="shrink-0">Modified</span>
            </label>
          </div>

          <div className={mode === 'mask' ? '' : 'hidden'}>
            <figure className="flex flex-col gap-1">
              <figcaption className="text-xs font-medium tracking-wide text-zinc-400 uppercase">
                Changed regions (magenta) with bounding boxes
              </figcaption>
              <canvas ref={maskRef} role="img" aria-label="Diff mask: greyscale original with changed pixels highlighted in magenta and bounding boxes around changed regions" className="h-auto max-w-full rounded-lg border border-zinc-800" />
            </figure>
          </div>
        </div>
      )}
    </section>
  )
}
