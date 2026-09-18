import { describe, expect, it } from 'vitest'
import { diffByLcs } from './lcs.ts'

describe('diffByLcs', () => {
  it('returns no ops for identical sequences', () => {
    expect(diffByLcs([1, 2, 3], [1, 2, 3])).toEqual([
      { op: 'equal', aIndex: 0, bIndex: 0 },
      { op: 'equal', aIndex: 1, bIndex: 1 },
      { op: 'equal', aIndex: 2, bIndex: 2 },
    ])
  })

  it('treats a pure reorder as a minimal delete/insert script', () => {
    const ops = diffByLcs([1, 2, 3, 4], [2, 1, 3, 4])
    expect(ops.filter((op) => op.op === 'equal')).toHaveLength(3)
    expect(ops.filter((op) => op.op !== 'equal')).toHaveLength(2)
  })

  it('handles pure insertions at the end', () => {
    expect(diffByLcs(['a'], ['a', 'b', 'c'])).toEqual([
      { op: 'equal', aIndex: 0, bIndex: 0 },
      { op: 'insert', bIndex: 1 },
      { op: 'insert', bIndex: 2 },
    ])
  })

  it('handles pure deletions and empty inputs', () => {
    expect(diffByLcs(['a', 'b', 'c'], ['c'])).toEqual([
      { op: 'delete', aIndex: 0 },
      { op: 'delete', aIndex: 1 },
      { op: 'equal', aIndex: 2, bIndex: 0 },
    ])
    expect(diffByLcs([], ['x'])).toEqual([{ op: 'insert', bIndex: 0 }])
    expect(diffByLcs(['x'], [])).toEqual([{ op: 'delete', aIndex: 0 }])
    expect(diffByLcs([], [])).toEqual([])
  })

  it('respects a custom equality predicate', () => {
    const byId = (x: { id: number }, y: { id: number }) => x.id === y.id
    const ops = diffByLcs([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }], byId)
    expect(ops.filter((op) => op.op === 'equal')).toHaveLength(1)
  })
})
