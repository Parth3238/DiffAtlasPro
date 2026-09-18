import { describe, expect, it } from 'vitest'
import { threeWayMerge } from './threeWayMerge.ts'

describe('threeWayMerge (JSON)', () => {
  it('merges cleanly when nothing changed', () => {
    const base = { a: 1, nested: { b: [1, 2] } }
    const result = threeWayMerge(base, structuredClone(base), structuredClone(base))
    expect(result.conflicts).toEqual([])
    expect(result.merged).toEqual(base)
  })

  it('applies single-side changes from either side', () => {
    const base = { keep: true, left: 'old', right: 'old' }
    const left = { keep: true, left: 'new', right: 'old' }
    const right = { keep: true, left: 'old', right: 'new' }
    const result = threeWayMerge(base, left, right)
    expect(result.conflicts).toEqual([])
    expect(result.merged).toEqual({ keep: true, left: 'new', right: 'new' })
  })

  it('applies identical changes made on both sides without conflict', () => {
    const base = { theme: 'light', count: 1 }
    const left = { theme: 'dark', count: 1 }
    const right = { theme: 'dark', count: 1 }
    const result = threeWayMerge(base, left, right)
    expect(result.conflicts).toEqual([])
    expect(result.merged).toEqual({ theme: 'dark', count: 1 })
  })

  it('merges identical additions on both sides once', () => {
    const base = { a: 1 }
    const left = { a: 1, added: [1, 2] }
    const right = { a: 1, added: [1, 2] }
    const result = threeWayMerge(base, left, right)
    expect(result.conflicts).toEqual([])
    expect(result.merged).toEqual({ a: 1, added: [1, 2] })
  })

  it('reports a conflict when both sides change the same path differently', () => {
    const base = { theme: 'light', timeout: 30 }
    const left = { theme: 'dark', timeout: 30 }
    const right = { theme: 'solarized', timeout: 30 }
    const result = threeWayMerge(base, left, right)
    expect(result.conflicts).toEqual([
      { path: 'theme', baseValue: 'light', leftValue: 'dark', rightValue: 'solarized' },
    ])
    // Conflicted paths keep the base value until resolved.
    expect(result.merged).toEqual({ theme: 'light', timeout: 30 })
  })

  it('merges nested objects per leaf, conflicting only on divergent leaves', () => {
    const base = { user: { name: 'Ann', role: 'eng', city: 'Berlin' } }
    const left = { user: { name: 'Annie', role: 'eng', city: 'Berlin' } }
    const right = { user: { name: 'Anna', role: 'staff', city: 'Berlin' } }
    const result = threeWayMerge(base, left, right)
    expect(result.conflicts).toEqual([
      {
        path: 'user.name',
        baseValue: 'Ann',
        leftValue: 'Annie',
        rightValue: 'Anna',
      },
    ])
    expect(result.merged).toEqual({ user: { name: 'Ann', role: 'staff', city: 'Berlin' } })
  })

  it('conflicts when one side removes a path the other side edits', () => {
    const base = { a: 'x', b: 1 }
    const left = { b: 1 }
    const right = { a: 'y', b: 1 }
    const result = threeWayMerge(base, left, right)
    expect(result.conflicts).toEqual([
      { path: 'a', baseValue: 'x', leftValue: undefined, rightValue: 'y' },
    ])
    expect(result.merged).toEqual({ a: 'x', b: 1 })
  })

  it('conflicts divergent additions of the same new key', () => {
    const base = { a: 1 }
    const left = { a: 1, feature: 'on' }
    const right = { a: 1, feature: 'off' }
    const result = threeWayMerge(base, left, right)
    expect(result.conflicts).toEqual([
      { path: 'feature', baseValue: undefined, leftValue: 'on', rightValue: 'off' },
    ])
    expect(result.merged).toEqual({ a: 1 })
  })
})
