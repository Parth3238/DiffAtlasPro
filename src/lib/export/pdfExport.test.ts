import { describe, expect, it } from 'vitest'
import { exportToPdf, type PdfExportInput } from './pdfExport.ts'

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function baseInput(overrides: Partial<PdfExportInput> = {}): PdfExportInput {
  return {
    title: 'JSON diff report',
    originalName: 'a.json',
    modifiedName: 'b.json',
    summaryLine: '1 added, 1 removed, 1 modified',
    changes: [
      { path: 'name', type: 'modified', oldValue: 'old', newValue: 'new' },
      { path: 'gone', type: 'removed', oldValue: 1 },
      { path: 'extra', type: 'added', newValue: { nested: [1, 2] } },
    ],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

async function pdfBytes(input: PdfExportInput): Promise<string> {
  const blob = await exportToPdf(input)
  expect(blob).toBeInstanceOf(Blob)
  expect(blob.type).toBe('application/pdf')
  const text = await blob.slice(0, 5).text()
  expect(text).toBe('%PDF-')
  const full = Buffer.from(await blob.arrayBuffer()).toString('latin1')
  expect(full).toContain('%%EOF')
  return full
}

describe('exportToPdf', () => {
  it('generates a readable JSON report with names, summary, and changes', async () => {
    const full = await pdfBytes(baseInput())
    expect(full).toContain('a.json')
    expect(full).toContain('b.json')
    expect(full).toContain('1 added, 1 removed, 1 modified')
  })

  it('handles an empty change list', async () => {
    const full = await pdfBytes(baseInput({ changes: [], summaryLine: 'no changes' }))
    expect(full).toContain('No differences found.')
  })

  it('paginates hundreds of rows into a valid document', async () => {
    const changes = Array.from({ length: 300 }, (_, i) => ({
      path: `items[${i}].value`,
      type: i % 2 === 0 ? 'modified' : 'added',
      oldValue: i,
      newValue: i + 1,
    }))
    const full = await pdfBytes(baseInput({ changes, truncatedCount: 1200 }))
    // NB: jsPDF escapes parentheses in literal strings.
    expect(full).toContain('more change\\(s\\) not listed')
    expect(full).toContain('items[')
  })

  it('embeds a diff-mask image with caption for image reports', async () => {
    const full = await pdfBytes(
      baseInput({
        title: 'Image diff report',
        originalName: 'before.png',
        modifiedName: 'after.png',
        summaryLine: '12.50% of image changed',
        changes: [],
        imageDataUrl: TINY_PNG,
        imageCaption: '12.50% of image changed across 3 regions',
      }),
    )
    expect(full).toContain('Diff mask')
    expect(full).toContain('12.50%')
  })
})
