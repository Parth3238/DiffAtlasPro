import { describe, expect, it } from 'vitest'
import {
  buildHistoryRecord,
  canReloadHistory,
  formatHistorySummary,
  HISTORY_CONTENT_LIMIT,
  historySignature,
} from './history.ts'
import type { LoadedFile } from '../diff-engine/core/types.ts'

const file = (content: string, type: LoadedFile['type'] = 'json', name = 'a.json'): LoadedFile => ({
  content,
  type,
  name,
})

describe('history record builder', () => {
  it('formats the summary line like the UI', () => {
    expect(formatHistorySummary({ added: 3, removed: 1, modified: 2, typeChanged: 0, unchanged: 0 })).toBe(
      '3 added, 1 removed, 2 modified, 0 type changes',
    )
    expect(formatHistorySummary({ added: 0, removed: 0, modified: 0, typeChanged: 0, unchanged: 9 })).toContain(
      '9 unchanged',
    )
  })

  it('keeps full content under the cap for reload', () => {
    const record = buildHistoryRecord(file('{"a":1}'), file('{"a":2}'), 'summary', 123)
    expect(record.createdAt).toBe(123)
    expect(record.summaryLine).toBe('summary')
    expect(record.contentOmitted).toBeUndefined()
    expect(record.original.content).toBe('{"a":1}')
    expect(canReloadHistory(record)).toBe(true)
  })

  it('omits content over the cap but keeps metadata', () => {
    const big = `{"data":"${'x'.repeat(HISTORY_CONTENT_LIMIT)}"}`
    const record = buildHistoryRecord(file(big, 'json', 'big.json'), file('{}'), 'summary')
    expect(record.contentOmitted).toBe(true)
    expect(record.original.content).toBe('')
    expect(record.original.name).toBe('big.json')
    expect(record.original.type).toBe('json')
    expect(canReloadHistory(record)).toBe(false)
  })

  it('produces stable, content-sensitive signatures', () => {
    const a = file('{"a":1}')
    const b = file('{"a":2}')
    expect(historySignature(a, b)).toBe(historySignature(file('{"a":1}'), file('{"a":2}')))
    expect(historySignature(a, b)).not.toBe(historySignature(a, file('{"a":3}')))
    expect(historySignature(a, b)).not.toBe(historySignature(b, a))
  })
})
