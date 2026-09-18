import { describe, expect, it } from 'vitest'
import { buildCsvTableModel } from './DiffResultPanel.tsx'
import { csvPlugin } from '../lib/diff-engine/plugins/csv.ts'

describe('buildCsvTableModel', () => {
  it('maps matched, modified, added and removed rows with aligned columns', () => {
    const result = csvPlugin.diff(
      'id,name,city\n1,Ann,Berlin\n2,Bob,Paris\n3,Cid,Rome\n',
      'id,name,city\n1,Ann,Munich\n2,Bob,Paris\n4,Dan,Oslo\n',
    )
    const model = buildCsvTableModel(result.changes, true)
    expect(model.columns).toEqual(['id', 'name', 'city'])
    expect(model.rows.map((r) => r.status)).toEqual(['modified', 'unchanged', 'removed', 'added'])
    const modifiedRow = model.rows[0]
    expect(modifiedRow.cells.map((c) => c.status)).toEqual(['unchanged', 'unchanged', 'modified'])
    expect(modifiedRow.cells[2]).toMatchObject({ oldValue: 'Berlin', newValue: 'Munich' })
    expect(model.rows[2].cells.map((c) => c.oldValue)).toEqual(['3', 'Cid', 'Rome'])
    expect(model.rows[3].cells.map((c) => c.newValue)).toEqual(['4', 'Dan', 'Oslo'])
  })

  it('hides fully-unchanged rows when showUnchanged is off', () => {
    const result = csvPlugin.diff(
      'id,name\n1,Ann\n2,Bob\n',
      'id,name\n1,Ann2\n2,Bob\n',
    )
    const hidden = buildCsvTableModel(result.changes, false)
    expect(hidden.rows.map((r) => r.status)).toEqual(['modified'])
    expect(hidden.rows[0].cells.map((c) => c.column)).toEqual(['name'])
    const shown = buildCsvTableModel(result.changes, true)
    expect(shown.rows.map((r) => r.status)).toEqual(['modified', 'unchanged'])
  })

  it('unions columns when headers differ', () => {
    const result = csvPlugin.diff('id,name\n1,Ann\n', 'id,name,role\n1,Ann,Eng\n')
    expect(result.status).toBe('ok')
    const model = buildCsvTableModel(result.changes, true)
    expect(model.columns).toEqual(['id', 'name', 'role'])
  })
})
