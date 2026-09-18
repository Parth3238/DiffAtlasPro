import { describe, expect, it } from 'vitest'
import { csvPlugin } from './csv.ts'
import type { DiffResult } from '../core/types.ts'

const diff = (original: string, modified: string): DiffResult =>
  csvPlugin.diff(original, modified)

const ofType = (result: DiffResult, type: string) =>
  result.changes.filter((change) => change.type === type)

const findChange = (result: DiffResult, path: string, type: string) =>
  result.changes.find((change) => change.path === path && change.type === type)

describe('CSV structural diff', () => {
  it('marks every cell unchanged for identical CSVs', () => {
    const csv = 'id,name,city\n1,Ann,Berlin\n2,Bob,Paris\n'
    const result = diff(csv, csv)
    expect(result.pluginId).toBe('csv')
    expect(result.status).toBe('ok')
    // 2 rows x 3 columns, all unchanged
    expect(result.changes).toHaveLength(6)
    expect(ofType(result, 'modified')).toHaveLength(0)
    expect(ofType(result, 'added')).toHaveLength(0)
    expect(ofType(result, 'removed')).toHaveLength(0)
    expect(findChange(result, 'row[0].id', 'unchanged')).toEqual({
      path: 'row[0].id', type: 'unchanged', oldValue: '1', newValue: '1',
    })
  })

  it('matches rows by key column and diffs changed cells', () => {
    const original = 'id,name,city\n1,Ann,Berlin\n2,Bob,Paris\n3,Cid,Rome\n'
    const modified = 'id,name,city\n1,Ann,Munich\n2,Bob,Paris\n4,Dan,Oslo\n'
    const result = diff(original, modified)
    expect(result.status).toBe('ok')
    expect(findChange(result, 'row[0].city', 'modified')).toEqual({
      path: 'row[0].city', type: 'modified', oldValue: 'Berlin', newValue: 'Munich',
    })
    expect(findChange(result, 'row[2]', 'removed')).toEqual({
      path: 'row[2]', type: 'removed', oldValue: { id: '3', name: 'Cid', city: 'Rome' },
    })
    expect(findChange(result, 'row[2]', 'added')).toEqual({
      path: 'row[2]', type: 'added', newValue: { id: '4', name: 'Dan', city: 'Oslo' },
    })
    expect(ofType(result, 'modified')).toHaveLength(1)
  })

  it('treats reordered keyed rows as moves, not additions/removals', () => {
    const original = 'id,name\n1,Ann\n2,Bob\n3,Cid\n'
    const modified = 'id,name\n3,Cid\n1,Ann\n2,Bob\n'
    const result = diff(original, modified)
    expect(result.status).toBe('ok')
    expect(ofType(result, 'added')).toHaveLength(0)
    expect(ofType(result, 'removed')).toHaveLength(0)
    expect(ofType(result, 'modified')).toHaveLength(0)
    // Every original row still matches its key: 3 rows x 2 columns unchanged
    expect(ofType(result, 'unchanged')).toHaveLength(6)
  })

  it('falls back to fuzzy matching when no key column exists', () => {
    const original = 'first,last,city,role\nAnn,Lee,Berlin,Eng\nAnn,Kim,Berlin,Eng\nBob,Lee,Paris,Eng\n'
    const modified = 'first,last,city,role\nAnn,Lee,Berlin,Eng\nAnn,Kim,Berlin,Design\nZoe,Mo,Rome,Art\n'
    const result = diff(original, modified)
    expect(result.status).toBe('ok')
    // 3 of 4 cells match (75% >= 70%), so row[1] pairs up with a single cell edit
    expect(findChange(result, 'row[1].role', 'modified')).toEqual({
      path: 'row[1].role', type: 'modified', oldValue: 'Eng', newValue: 'Design',
    })
    // The wholly dissimilar row falls below the threshold: pure remove + add
    expect(findChange(result, 'row[2]', 'removed')).toEqual({
      path: 'row[2]',
      type: 'removed',
      oldValue: { first: 'Bob', last: 'Lee', city: 'Paris', role: 'Eng' },
    })
    expect(findChange(result, 'row[2]', 'added')).toEqual({
      path: 'row[2]',
      type: 'added',
      newValue: { first: 'Zoe', last: 'Mo', city: 'Rome', role: 'Art' },
    })
    expect(ofType(result, 'modified')).toHaveLength(1)
  })

  it('falls back to fuzzy matching when the id-like column has duplicates', () => {
    const original = 'id,name,city,role\nx,Ann,Berlin,Eng\nx,Ann,Paris,Eng\n'
    const modified = 'id,name,city,role\nx,Ann,Berlin,Design\ny,Ann,Berlin,Eng\n'
    const result = diff(original, modified)
    expect(result.status).toBe('ok')
    // "id" is not unique, so rows pair by similarity (3/4 cells = 75%)
    expect(findChange(result, 'row[0].role', 'modified')).toEqual({
      path: 'row[0].role', type: 'modified', oldValue: 'Eng', newValue: 'Design',
    })
    expect(findChange(result, 'row[1]', 'removed')).toBeDefined()
    expect(findChange(result, 'row[1]', 'added')).toBeDefined()
  })

  it('reports added and removed rows by key with no cell edits', () => {
    const original = 'id,name\n1,Ann\n2,Bob\n'
    const modified = 'id,name\n2,Bob\n3,Cid\n'
    const result = diff(original, modified)
    expect(result.status).toBe('ok')
    expect(findChange(result, 'row[0]', 'removed')).toEqual({
      path: 'row[0]', type: 'removed', oldValue: { id: '1', name: 'Ann' },
    })
    expect(findChange(result, 'row[1]', 'added')).toEqual({
      path: 'row[1]', type: 'added', newValue: { id: '3', name: 'Cid' },
    })
    expect(ofType(result, 'modified')).toHaveLength(0)
  })

  it('reports an error for input without a header row', () => {
    const result = diff('', 'id,name\n1,Ann\n')
    expect(result.pluginId).toBe('csv')
    expect(result.status).toBe('error')
    expect(typeof result.error).toBe('string')
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0].type).toBe('error')
  })
})
