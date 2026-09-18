import { describe, expect, it } from 'vitest'
import { jsonPlugin } from '../diff-engine/plugins/json.ts'
import { toJsonPatch, toJsonPatchPointer, type JsonPatchOp } from './jsonPatchExport.ts'

function parsePointer(pointer: string): string[] {
  if (pointer === '') return []
  if (!pointer.startsWith('/')) throw new Error(`Invalid JSON Pointer: ${pointer}`)
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
}

/** Minimal RFC 6902 applier (add/remove/replace) used to validate our output. */
function applyPatch(document: unknown, ops: JsonPatchOp[]): unknown {
  let root: unknown = structuredClone(document)
  for (const op of ops) {
    const segments = parsePointer(op.path)
    if (segments.length === 0) {
      root = op.op === 'remove' ? undefined : structuredClone(op.value)
      continue
    }
    let parent = root as Record<string, unknown> & unknown[]
    for (const segment of segments.slice(0, -1)) {
      parent = (Array.isArray(parent) ? parent[Number(segment)] : parent[segment]) as typeof parent
    }
    const key = segments[segments.length - 1]
    if (Array.isArray(parent)) {
      const index = key === '-' ? parent.length : Number(key)
      if (op.op === 'add') parent.splice(index, 0, structuredClone(op.value))
      else if (op.op === 'remove') parent.splice(index, 1)
      else parent[index] = structuredClone(op.value)
    } else {
      const record = parent as Record<string, unknown>
      if (op.op === 'remove') delete record[key]
      else record[key] = structuredClone(op.value)
    }
  }
  return root
}

async function patchBetween(original: unknown, modified: unknown): Promise<JsonPatchOp[]> {
  const result = jsonPlugin.diff(JSON.stringify(original), JSON.stringify(modified))
  return toJsonPatch(result.changes)
}

describe('toJsonPatchPointer', () => {
  it('converts dotted, indexed, and root paths', () => {
    expect(toJsonPatchPointer('name')).toBe('/name')
    expect(toJsonPatchPointer('user.address.city')).toBe('/user/address/city')
    expect(toJsonPatchPointer('users[0].name')).toBe('/users/0/name')
    expect(toJsonPatchPointer('[0]')).toBe('/0')
    expect(toJsonPatchPointer('')).toBe('')
    expect(toJsonPatchPointer('row[0].city')).toBe('/row/0/city')
  })

  it('escapes ~ and / per RFC 6901', () => {
    expect(toJsonPatchPointer('a/b')).toBe('/a~1b')
    expect(toJsonPatchPointer('a~b')).toBe('/a~0b')
  })
})

describe('toJsonPatch', () => {
  it('maps flat add/remove/replace (RFC 6902 Appendix A shapes)', () => {
    return expect(
      toJsonPatch([
        { path: 'gone', type: 'removed', oldValue: 1 },
        { path: 'name', type: 'modified', oldValue: 'old', newValue: 'new' },
        { path: 'extra', type: 'added', newValue: 2 },
      ]),
    ).resolves.toEqual([
      { op: 'remove', path: '/gone' },
      { op: 'replace', path: '/name', value: 'new' },
      { op: 'add', path: '/extra', value: 2 },
    ])
  })

  it('maps type-changed to replace and skips unchanged/error entries', async () => {
    const ops = await toJsonPatch([
      { path: 'port', type: 'type-changed', oldValue: '8080', newValue: 8080 },
      { path: 'same', type: 'unchanged', oldValue: 1, newValue: 1 },
      { path: '$', type: 'error', oldValue: 'x', newValue: 'y' },
    ])
    expect(ops).toEqual([{ op: 'replace', path: '/port', value: 8080 }])
  })

  it('only ever emits add, remove, and replace', async () => {
    const result = jsonPlugin.diff(
      JSON.stringify({ a: 1, b: [1, 2], c: 'x' }),
      JSON.stringify({ a: 2, b: [2, 3], d: true }),
    )
    const ops = await toJsonPatch(result.changes)
    expect(ops.length).toBeGreaterThan(0)
    for (const op of ops) {
      expect(['add', 'remove', 'replace']).toContain(op.op)
      if (op.op === 'remove') expect('value' in op).toBe(false)
      else expect('value' in op).toBe(true)
    }
  })

  it.each([
    ['flat object', { a: 1, gone: 1 }, { a: 2, extra: true }],
    ['nested (RFC A.1/A.3/A.4 style)', { foo: 'bar', baz: 'qux' }, { foo: 'boo', hello: ['world'] }],
    ['array element replace', [1, 2, 3], [1, 9, 3]],
    ['reordered primitives (LCS script order)', [1, 2, 3, 4], [2, 1, 3, 4]],
    ['id-matched objects', { users: [{ id: 1, n: 'A' }] }, { users: [{ id: 1, n: 'B' }, { id: 2, n: 'C' }] }],
    ['deep nesting', { a: { b: { c: { d: 1 } } } }, { a: { b: { c: { d: 2, e: [] } } } }],
  ])('round-trips %s: applying the patch reproduces the modified doc', async (_label, original, modified) => {
    const ops = await patchBetween(original, modified)
    expect(applyPatch(original, ops)).toEqual(modified)
  })
})
