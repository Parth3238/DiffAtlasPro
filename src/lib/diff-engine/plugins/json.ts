import { diffByLcs, type LcsOp } from '../core/lcs.ts'
import type { DiffChange, DiffPlugin, DiffResult } from '../core/types.ts'

function typeTag(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

function isPrimitive(value: unknown): boolean {
  return value === null || typeof value !== 'object'
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeTag(a) !== typeTag(b)) return false
  if (isPrimitive(a)) return false
  if (Array.isArray(a)) {
    return (
      Array.isArray(b) &&
      a.length === (b as unknown[]).length &&
      a.every((item, index) => valuesEqual(item, (b as unknown[])[index]))
    )
  }
  const aRecord = a as Record<string, unknown>
  const bRecord = b as Record<string, unknown>
  const aKeys = Object.keys(aRecord).sort()
  const bKeys = Object.keys(bRecord).sort()
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key, index) => key === bKeys[index] && valuesEqual(aRecord[key], bRecord[key]))
  )
}

function buildArrayChanges(
  parentPath: string,
  ops: LcsOp[],
  a: readonly unknown[],
  b: readonly unknown[],
): DiffChange[] {
  const changes: DiffChange[] = []
  for (const step of ops) {
    if (step.op === 'equal') continue
    if (step.op === 'delete') {
      changes.push({
        path: `${parentPath}[${step.aIndex}]`,
        type: 'removed',
        oldValue: a[step.aIndex],
      })
      continue
    }
    changes.push({
      path: `${parentPath}[${step.bIndex}]`,
      type: 'added',
      newValue: b[step.bIndex],
    })
  }
  return changes
}

function deepDiff(a: unknown, b: unknown, path: string, changes: DiffChange[]): void {
  const aTag = typeTag(a)
  const bTag = typeTag(b)

  if (aTag !== bTag) {
    const integerToFloat = aTag === 'integer' && bTag === 'number'
    changes.push(
      integerToFloat
        ? { path, type: 'modified', oldValue: a, newValue: b }
        : { path, type: 'type-changed', oldValue: a, newValue: b },
    )
    return
  }

  if (valuesEqual(a, b)) return

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.every(isPrimitive) && b.every(isPrimitive)) {
      changes.push(...buildArrayChanges(path, diffByLcs(a, b), a, b))
      return
    }
    if (matchById(a, b, path, changes)) return
    indexPairDiff(a, b, path, changes)
    return
  }

  if (!isPrimitive(a) && !isPrimitive(b)) {
    const aRecord = a as Record<string, unknown>
    const bRecord = b as Record<string, unknown>
    const keys = new Set([...Object.keys(aRecord), ...Object.keys(bRecord)])
    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key
      const inA = key in aRecord
      const inB = key in bRecord
      if (inA && !inB) {
        changes.push({ path: childPath, type: 'removed', oldValue: aRecord[key] })
      } else if (!inA && inB) {
        changes.push({ path: childPath, type: 'added', newValue: bRecord[key] })
      } else {
        deepDiff(aRecord[key], bRecord[key], childPath, changes)
      }
    }
    return
  }

  changes.push({ path, type: 'modified', oldValue: a, newValue: b })
}

function indexPairDiff(
  a: readonly unknown[],
  b: readonly unknown[],
  parentPath: string,
  changes: DiffChange[],
): void {
  const shared = Math.min(a.length, b.length)
  for (let i = 0; i < shared; i++) {
    deepDiff(a[i], b[i], `${parentPath}[${i}]`, changes)
  }
  for (let i = shared; i < a.length; i++) {
    changes.push({ path: `${parentPath}[${i}]`, type: 'removed', oldValue: a[i] })
  }
  for (let i = shared; i < b.length; i++) {
    changes.push({ path: `${parentPath}[${i}]`, type: 'added', newValue: b[i] })
  }
}

function idOf(item: unknown): unknown {
  if (isPrimitive(item)) return undefined
  const record = item as Record<string, unknown>
  if ('id' in record) return record.id
  if ('key' in record) return record.key
  return undefined
}

function matchById(
  a: readonly unknown[],
  b: readonly unknown[],
  parentPath: string,
  changes: DiffChange[],
): boolean {
  if (a.length === 0 || b.length === 0) return false
  const aIds = a.map(idOf)
  if (aIds.some((id) => id === undefined)) return false
  const bIdToIndex = new Map<unknown, number>()
  for (const [index, item] of b.entries()) {
    const id = idOf(item)
    if (id === undefined || bIdToIndex.has(id)) return false
    bIdToIndex.set(id, index)
  }
  const matchedB = new Set<number>()
  for (const [aIndex, id] of aIds.entries()) {
    const bIndex = bIdToIndex.get(id)
    if (bIndex === undefined) {
      changes.push({
        path: `${parentPath}[${aIndex}]`,
        type: 'removed',
        oldValue: a[aIndex],
      })
      continue
    }
    matchedB.add(bIndex)
    deepDiff(a[aIndex], b[bIndex], `${parentPath}[${aIndex}]`, changes)
  }
  for (const [bIndex, item] of b.entries()) {
    if (!matchedB.has(bIndex)) {
      changes.push({
        path: `${parentPath}[${bIndex}]`,
        type: 'added',
        newValue: item,
      })
    }
  }
  return true
}

export const jsonPlugin: DiffPlugin = {
  id: 'json',
  matches(filename, content) {
    if (/\.json$/i.test(filename)) return true
    if (!content.trim()) return false
    try {
      JSON.parse(content)
      return true
    } catch {
      return false
    }
  },
  diff(original: string, modified: string): DiffResult {
    let originalValue: unknown
    let modifiedValue: unknown
    try {
      originalValue = JSON.parse(original)
      modifiedValue = JSON.parse(modified)
    } catch (error) {
      return {
        pluginId: 'json',
        status: 'error',
        error: (error as Error).message,
        changes: [{ type: 'error', path: '$', oldValue: original, newValue: modified }],
      }
    }
    const changes: DiffChange[] = []
    deepDiff(originalValue, modifiedValue, '', changes)
    return { pluginId: 'json', status: 'ok', changes }
  },
}
