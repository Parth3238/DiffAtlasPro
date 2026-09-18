import { jsonPlugin } from '../diff-engine/plugins/json.ts'
import type { DiffChange } from '../diff-engine/core/types.ts'

export interface ConflictItem {
  path: string
  baseValue: unknown
  leftValue: unknown
  rightValue: unknown
}

export interface ThreeWayMergeResult {
  /** Base with all non-conflicting changes applied; conflicted paths keep the base value. */
  merged: object
  conflicts: ConflictItem[]
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => deepEqual(item, (b as unknown[])[index]))
  }
  const aRecord = a as Record<string, unknown>
  const bRecord = b as Record<string, unknown>
  const aKeys = Object.keys(aRecord)
  const bKeys = Object.keys(bRecord)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => key in bRecord && deepEqual(aRecord[key], bRecord[key]))
}

export type PathSegment = string | number

/** Splits an engine path like `user.tags[0].name` into `['user','tags',0,'name']`. */
export function parseMergePath(path: string): PathSegment[] {
  if (!path) return []
  const segments: PathSegment[] = []
  const re = /([^.[\]]+)|\[(\d+)\]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(path)) !== null) {
    if (match[1] !== undefined) segments.push(match[1])
    else segments.push(Number(match[2]))
  }
  return segments
}

function isStrictPrefix(shorter: readonly PathSegment[], longer: readonly PathSegment[]): boolean {
  return (
    shorter.length < longer.length &&
    shorter.every((segment, index) => segment === longer[index])
  )
}

function isPrefixOrEqual(a: readonly PathSegment[], b: readonly PathSegment[]): boolean {
  return (
    a.length <= b.length && a.every((segment, index) => segment === b[index])
  )
}

export function getValueAtPath(root: unknown, path: string): unknown {
  let current = root
  for (const segment of parseMergePath(path)) {
    if (current === null || current === undefined) return undefined
    current = (current as Record<string | number, unknown>)[segment]
  }
  return current
}

export function setValueAtPath(root: object, path: string, value: unknown): void {
  const segments = parseMergePath(path)
  if (segments.length === 0) return
  let current = root as Record<string | number, unknown>
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]
    const next = segments[i + 1]
    const existing = current[segment]
    if (typeof existing !== 'object' || existing === null) {
      const created: Record<string | number, unknown> | unknown[] =
        typeof next === 'number' ? [] : {}
      current[segment] = created
      current = created as Record<string | number, unknown>
    } else {
      current = existing as Record<string | number, unknown>
    }
  }
  const last = segments[segments.length - 1]
  if (Array.isArray(current) && typeof last === 'number') {
    current[last] = value
  } else {
    ;(current as Record<string | number, unknown>)[last] = value
  }
}

export function deleteValueAtPath(root: object, path: string): void {
  const segments = parseMergePath(path)
  if (segments.length === 0) return
  let current: unknown = root
  for (let i = 0; i < segments.length - 1; i++) {
    if (current === null || typeof current !== 'object') return
    current = (current as Record<string | number, unknown>)[segments[i]]
  }
  if (current === null || typeof current !== 'object') return
  const last = segments[segments.length - 1]
  if (Array.isArray(current) && typeof last === 'number') {
    if (last >= 0 && last < current.length) current.splice(last, 1)
  } else {
    delete (current as Record<string | number, unknown>)[last]
  }
}

function diffObjects(base: object, side: object): DiffChange[] {
  // Reuses the JSON tree-diff (base vs side) to discover each side's edits.
  return jsonPlugin.diff(JSON.stringify(base), JSON.stringify(side)).changes
}

/** Both sides applied the same operation (same type and same resulting value). */
function isSameChange(left: DiffChange, right: DiffChange): boolean {
  if (left.type !== right.type) return false
  if (left.type === 'removed') return true
  return deepEqual(left.newValue, right.newValue)
}

function cloneValue<T>(value: T): T {
  return value === undefined ? value : structuredClone(value)
}

function applyChange(merged: object, change: DiffChange): void {
  if (change.path === '') return
  if (change.type === 'removed') {
    deleteValueAtPath(merged, change.path)
  } else {
    setValueAtPath(merged, change.path, cloneValue(change.newValue))
  }
}

/**
 * Git-style three-way merge for JSON objects. Each side's edits are discovered
 * with the JSON tree-diff (base vs left, base vs right), then applied per path:
 * one-sided edits and identical edits on both sides merge cleanly, while
 * divergent edits to the same (or overlapping) paths become conflicts that keep
 * the base value in `merged` until resolved.
 */
export function threeWayMerge(base: object, left: object, right: object): ThreeWayMergeResult {
  const leftChanges = diffObjects(base, left)
  const rightChanges = diffObjects(base, right)

  const leftRoot = leftChanges.find((change) => change.path === '')
  const rightRoot = rightChanges.find((change) => change.path === '')

  // Whole-document replacement is too coarse for per-path rules: take a clean
  // side outright, keep identical replacements, otherwise conflict at '(root)'.
  if (leftRoot ?? rightRoot) {
    const leftOnly = leftRoot && !rightRoot && rightChanges.length === 0
    const rightOnly = rightRoot && !leftRoot && leftChanges.length === 0
    if (leftOnly || rightOnly) {
      const winner = leftOnly ? left : right
      return { merged: structuredClone(winner), conflicts: [] }
    }
    const bothRoots =
      leftRoot && rightRoot && leftRoot.type === rightRoot.type &&
      (leftRoot.type === 'removed' || deepEqual(leftRoot.newValue, rightRoot.newValue))
    if (bothRoots && leftChanges.length === 1 && rightChanges.length === 1) {
      const winner = leftRoot.type === 'removed' ? {} : (leftRoot.newValue as object)
      return { merged: structuredClone(winner), conflicts: [] }
    }
    return {
      merged: structuredClone(base),
      conflicts: [{ path: '', baseValue: base, leftValue: left, rightValue: right }],
    }
  }

  const merged: object = structuredClone(base)
  const conflicts: ConflictItem[] = []
  const conflictedAncestors: PathSegment[][] = []
  const isUnderConflict = (segments: readonly PathSegment[]): boolean =>
    conflictedAncestors.some((ancestor) => isPrefixOrEqual(ancestor, segments))

  const recordConflict = (path: string, segments: PathSegment[]): void => {
    conflictedAncestors.push(segments)
    conflicts.push({
      path,
      baseValue: cloneValue(getValueAtPath(base, path)),
      leftValue: cloneValue(getValueAtPath(left, path)),
      rightValue: cloneValue(getValueAtPath(right, path)),
    })
  }

  const rightByPath = new Map(rightChanges.map((change) => [change.path, change] as const))
  const handledRight = new Set<string>()

  for (const leftChange of leftChanges) {
    const segments = parseMergePath(leftChange.path)
    if (isUnderConflict(segments)) continue
    const rightChange = rightByPath.get(leftChange.path)
    if (rightChange) {
      handledRight.add(leftChange.path)
      if (isSameChange(leftChange, rightChange)) {
        applyChange(merged, leftChange)
      } else {
        recordConflict(leftChange.path, segments)
      }
      continue
    }
    // Different granularity on the two sides (e.g. left rewrote `a` while
    // right edited `a.b`): conflict at the ancestor with full subtree values.
    const overlap = rightChanges.find(
      (candidate) =>
        !handledRight.has(candidate.path) &&
        (isStrictPrefix(segments, parseMergePath(candidate.path)) ||
          isStrictPrefix(parseMergePath(candidate.path), segments)),
    )
    if (overlap) {
      const overlapSegments = parseMergePath(overlap.path)
      const ancestor =
        segments.length <= overlapSegments.length
          ? { path: leftChange.path, segments }
          : { path: overlap.path, segments: overlapSegments }
      handledRight.add(overlap.path)
      recordConflict(ancestor.path, ancestor.segments)
      continue
    }
    applyChange(merged, leftChange)
  }

  for (const rightChange of rightChanges) {
    if (handledRight.has(rightChange.path)) continue
    if (isUnderConflict(parseMergePath(rightChange.path))) continue
    applyChange(merged, rightChange)
  }

  conflicts.sort((a, b) => a.path.localeCompare(b.path))
  return { merged, conflicts }
}
