export interface PdfReportChange {
  path: string
  type: string
  oldValue?: unknown
  newValue?: unknown
}

export interface PdfExportInput {
  /** e.g. "JSON diff report". */
  title: string
  originalName: string
  modifiedName: string
  /** One-line human summary, e.g. "3 added, 1 removed, 2 modified". */
  summaryLine: string
  changes: PdfReportChange[]
  /** When the caller truncated `changes`, how many were left out. */
  truncatedCount?: number
  /** Optional diff-mask embed for image reports. */
  imageDataUrl?: string
  imageCaption?: string
  /** Extra note lines (resize warnings, column warnings, …). */
  notes?: string[]
  createdAt?: Date
}

const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842
const MARGIN = 48
const MAX_TEXT_WIDTH = PAGE_WIDTH - MARGIN * 2

const TYPE_COLORS: Record<string, [number, number, number]> = {
  added: [16, 122, 87],
  removed: [220, 38, 38],
  modified: [180, 100, 8],
  'type-changed': [126, 34, 206],
  unchanged: [113, 113, 122],
  error: [220, 38, 38],
}

function formatPdfValue(value: unknown): string {
  if (value === undefined) return '—'
  if (typeof value === 'string') return value || '—'
  try {
    const text = JSON.stringify(value)
    if (text === undefined) return String(value)
    return text.length > 500 ? `${text.slice(0, 497)}…` : text
  } catch {
    return String(value)
  }
}

function imageFormat(dataUrl: string): 'PNG' | 'JPEG' {
  return dataUrl.toLowerCase().includes('image/jpeg') || dataUrl.toLowerCase().includes('image/jpg')
    ? 'JPEG'
    : 'PNG'
}

/**
 * Generates a clean, self-contained PDF diff report (no external API).
 * jsPDF is dynamically imported so it stays out of the main bundle until
 * the user actually exports. Callers pre-filter changes; at most MAX_ROWS
 * are rendered with a truncation note for the rest.
 */
export async function exportToPdf(input: PdfExportInput): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  let y = MARGIN

  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE_HEIGHT - MARGIN) {
      doc.addPage()
      y = MARGIN
    }
  }

  // Header
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(24, 24, 27)
  doc.text(input.title, MARGIN, y)
  y += 22

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(113, 113, 122)
  const created = input.createdAt ?? new Date()
  for (const line of [
    `Original: ${input.originalName}`,
    `Modified: ${input.modifiedName}`,
    `Generated: ${created.toISOString()}`,
    `Summary: ${input.summaryLine}`,
  ]) {
    doc.text(line, MARGIN, y)
    y += 14
  }
  y += 6

  for (const note of input.notes ?? []) {
    doc.setFontSize(10)
    doc.setTextColor(180, 100, 8)
    const wrapped = doc.splitTextToSize(`Note: ${note}`, MAX_TEXT_WIDTH) as string[]
    ensureSpace(wrapped.length * 13 + 4)
    doc.text(wrapped, MARGIN, y)
    y += wrapped.length * 13 + 4
  }

  // Changes
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(24, 24, 27)
  ensureSpace(20)
  doc.text(`Changes (${input.changes.length})`, MARGIN, y)
  y += 16

  if (input.changes.length === 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(113, 113, 122)
    doc.text('No differences found.', MARGIN, y)
    y += 14
  }

  for (const change of input.changes) {
    const color = TYPE_COLORS[change.type] ?? [24, 24, 27]
    const label = `[${change.type.toUpperCase()}]`
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    const labelWidth = doc.getTextWidth(label)
    doc.setFont('helvetica', 'normal')
    const pathLines = doc.splitTextToSize(change.path || '(root)', MAX_TEXT_WIDTH - labelWidth - 6) as string[]
    const oldLines = doc.splitTextToSize(`old: ${formatPdfValue(change.oldValue)}`, MAX_TEXT_WIDTH - 12) as string[]
    const newLines = doc.splitTextToSize(`new: ${formatPdfValue(change.newValue)}`, MAX_TEXT_WIDTH - 12) as string[]
    ensureSpace((1 + pathLines.length - 1 + oldLines.length + newLines.length) * 12 + 10)

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...color)
    doc.text(label, MARGIN, y)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(24, 24, 27)
    doc.text(pathLines, MARGIN + labelWidth + 6, y)
    y += pathLines.length * 12

    doc.setFont('courier', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(82, 82, 91)
    doc.text(oldLines, MARGIN + 12, y)
    y += oldLines.length * 11
    doc.text(newLines, MARGIN + 12, y)
    y += newLines.length * 11 + 8
  }

  if ((input.truncatedCount ?? 0) > 0) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(10)
    doc.setTextColor(113, 113, 122)
    ensureSpace(16)
    doc.text(`…and ${input.truncatedCount} more change(s) not listed in this report.`, MARGIN, y)
    y += 16
  }

  // Optional diff-mask image
  if (input.imageDataUrl) {
    ensureSpace(120)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(24, 24, 27)
    doc.text('Diff mask', MARGIN, y)
    y += 16
    try {
      const maxW = MAX_TEXT_WIDTH
      const maxH = 380
      const props = doc.getImageProperties(input.imageDataUrl)
      const scale = Math.min(maxW / props.width, maxH / props.height, 1)
      const w = Math.max(1, Math.round(props.width * scale))
      const h = Math.max(1, Math.round(props.height * scale))
      if (y + h > PAGE_HEIGHT - MARGIN) {
        doc.addPage()
        y = MARGIN
      }
      doc.addImage(input.imageDataUrl, imageFormat(input.imageDataUrl), MARGIN, y, w, h)
      y += h + 8
    } catch {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(220, 38, 38)
      doc.text('Diff-mask image could not be embedded.', MARGIN, y)
      y += 14
    }
    if (input.imageCaption) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(113, 113, 122)
      const caption = doc.splitTextToSize(input.imageCaption, MAX_TEXT_WIDTH) as string[]
      ensureSpace(caption.length * 13)
      doc.text(caption, MARGIN, y)
      y += caption.length * 13
    }
  }

  // Footers
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(161, 161, 170)
    doc.text(`DiffAtlas • page ${page} of ${pages}`, MARGIN, PAGE_HEIGHT - 24)
  }

  return doc.output('blob')
}

/** Triggers a download for a Blob in the browser. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
