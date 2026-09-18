import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { detectFileType } from '../lib/diff-engine/core/registry.ts'
import type { LoadedFile } from '../lib/diff-engine/core/types.ts'

interface FileInputPanelProps {
  label: string
  onFileLoaded: (file: LoadedFile) => void
  /**
   * Pre-populates the panel (share links, history reload). The parent must
   * remount via `key` for a new seed to take effect; the seeded content is
   * auto-loaded once on mount so the diff runs without an extra click.
   */
  initialContent?: string
  initialFilename?: string
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(file.name)
}

function asLoadedFile(filename: string, content: string): LoadedFile {
  const type = detectFileType(filename, content)
  const dataUrl = content.startsWith('data:image/') ? content : undefined
  const file: LoadedFile = { content, type }
  if (dataUrl) file.dataUrl = dataUrl
  if (filename) file.name = filename
  return file
}

export default function FileInputPanel({
  label,
  onFileLoaded,
  initialContent = '',
  initialFilename = '',
}: FileInputPanelProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [filename, setFilename] = useState(initialFilename)
  const [content, setContent] = useState(initialContent)
  const [detectedType, setDetectedType] = useState<string | null>(() =>
    initialContent ? detectFileType(initialFilename, initialContent) : null,
  )
  const fileInputRef = useRef<HTMLInputElement>(null)
  const autoLoadedRef = useRef(false)

  // Mount-only: auto-load seeded content (share links, history reload).
  useEffect(() => {
    if (!autoLoadedRef.current && initialContent) {
      autoLoadedRef.current = true
      onFileLoaded(asLoadedFile(initialFilename, initialContent))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const readAsText = (file: File) => {
    if (isImageFile(file)) {
      readAsDataUrl(file)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      setFilename(file.name)
      setContent(text)
      setDetectedType(detectFileType(file.name, text))
    }
    reader.readAsText(file)
  }

  const readAsDataUrl = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result ?? '')
      setFilename(file.name)
      setContent(url)
      setDetectedType(detectFileType(file.name, url))
    }
    reader.readAsDataURL(file)
  }

  const openFilePicker = () => {
    fileInputRef.current?.click()
  }

  const handleDropZoneKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openFilePicker()
    }
  }
  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setIsDragging(false)
      const file = event.dataTransfer.files[0]
      if (file) readAsText(file)
    },
    [onFileLoaded],
  )

  const handlePaste = (text: string) => {
    setContent(text)
    setDetectedType(detectFileType(filename, text))
  }

  const handleLoad = () => {
    onFileLoaded(asLoadedFile(filename, content))
  }

  const isImagePreview = content.startsWith('data:image/')

  return (
    <section className="flex h-full flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">{label}</h2>
        {detectedType && (
          <span className="rounded-full border border-teal-800/60 bg-teal-950/40 px-2.5 py-0.5 text-xs font-medium text-teal-300">
            {detectedType}
          </span>
        )}
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-label={`Upload ${label} file — activate to browse, or drag and drop a file here`}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onKeyDown={handleDropZoneKeyDown}
        className={`flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center transition-colors focus-visible:border-teal-500 focus-visible:bg-teal-950/20 ${
          isDragging
            ? 'border-teal-500 bg-teal-950/20'
            : 'border-zinc-700 bg-zinc-900/60 hover:border-zinc-500'
        }`}
        onClick={openFilePicker}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="sr-only"
          aria-label={`Choose ${label.toLowerCase()} file`}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) readAsText(file)
          }}
        />
        <p className="text-sm text-zinc-300">Drop a file here</p>
        <p className="text-xs text-zinc-500">or click to browse · JSON, YAML, CSV, images</p>
      </div>

      <textarea
        value={content}
        onChange={(e) => handlePaste(e.target.value)}
        placeholder="…or paste content directly"
        spellCheck={false}
        aria-label={`${label} content — paste file content here`}
        className={`h-44 w-full flex-1 resize-none rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 font-mono text-xs text-zinc-300 placeholder:text-zinc-600 focus:border-teal-700 focus:outline-none ${isImagePreview ? 'hidden' : ''}`}
      />
      {isImagePreview && (
        <div className="flex h-44 w-full flex-1 items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/70 p-2">
          <img src={content} alt={`${label} preview`} className="max-h-full max-w-full object-contain" />
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-xs text-zinc-500">{filename || 'No file selected'}</span>
        <button
          type="button"
          disabled={!content.trim()}
          onClick={handleLoad}
          aria-label={`Load ${label.toLowerCase()} file for comparison`}
          className="rounded-md bg-teal-600 px-3.5 py-1.5 text-xs font-semibold text-zinc-950 transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          Load file
        </button>
      </div>
    </section>
  )
}
