import type { DiffChange } from '../diff-engine/core/types.ts'

export type JsonPatchOpType = 'add' | 'remove' | 'replace'

export interface JsonPatchOp {
  op: JsonPatchOpType
  /** RFC 6901 JSON Pointer, e.g. "/user/address/city". Empty string = whole document. */
  path: string
  value?: unknown
}

/**
 * Splits an engine path ("user.address.city", "users[0].name", "[0]", "")
 * into pointer segments. Note: object keys containing "." are ambiguous in
 * the engine's dotted grammar and are treated as nested segments.
 */
export function toJsonPatchPointer(enginePath: string): string {
  if (enginePath === '' || enginePath === '$') return ''
  const segments: string[] = []
  const re = /([^.[\]]+)|\[(\d+)\]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(enginePath)) !== null) {
    segments.push(match[1] !== undefined ? match[1] : match[2])
  }
  return `/${segments.map(escapePointerSegment).join('/')}`
}

/** RFC 6901 escaping: "~" -> "~0", then "/" -> "~1". */
export function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1')
}

/**
 * Converts engine changes into a valid RFC 6902 JSON Patch array, preserving
 * engine order (the engine emits LCS-script order, which applies cleanly):
 * - added -> { op: "add", path, value: newValue }
 * - removed -> { op: "remove", path }
 * - modified / type-changed -> { op: "replace", path, value: newValue }
 * Unchanged and error entries carry no transformation and are skipped.
 */
export async function toJsonPatch(changes: DiffChange[]): Promise<JsonPatchOp[]> {
  const ops: JsonPatchOp[] = []
  for (const change of changes) {
    const path = toJsonPatchPointer(change.path)
    switch (change.type) {
      case 'added':
        ops.push({ op: 'add', path, value: change.newValue })
        break
      case 'removed':
        ops.push({ op: 'remove', path })
        break
      case 'modified':
      case 'type-changed':
        ops.push({ op: 'replace', path, value: change.newValue })
        break
      default:
        break
    }
  }
  return ops
}
