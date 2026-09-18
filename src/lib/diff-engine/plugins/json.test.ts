import { describe, expect, it } from 'vitest'
import { jsonPlugin } from './json.ts'

const diff = (a: unknown, b: unknown) => jsonPlugin.diff(JSON.stringify(a), JSON.stringify(b))

describe('JSON structural diff', () => {
  it('compares flat keys and omits unchanged values', () => {
    expect(diff({ same: true, gone: 1, name: 'old' }, { same: true, name: 'new', extra: 2 })).toEqual({
      pluginId: 'json', status: 'ok', changes: [
        { path: 'gone', type: 'removed', oldValue: 1 },
        { path: 'name', type: 'modified', oldValue: 'old', newValue: 'new' },
        { path: 'extra', type: 'added', newValue: 2 },
      ],
    })
  })

  it('builds dotted paths for nested object changes', () => {
    const original = { user: { address: { city: 'Berlin', zip: '10115' } } }
    const modified = { user: { address: { city: 'Munich', zip: '10115' } } }
    expect(diff(original, modified)).toEqual({
      pluginId: 'json', status: 'ok', changes: [
        { path: 'user.address.city', type: 'modified', oldValue: 'Berlin', newValue: 'Munich' },
      ],
    })
  })

  it('uses LCS so reordered primitive arrays produce a minimal diff', () => {
    const changes = diff([1, 2, 3, 4], [2, 1, 3, 4]).changes
    expect(changes).toEqual([
      { path: '[0]', type: 'removed', oldValue: 1 },
      { path: '[1]', type: 'added', newValue: 1 },
    ])
  })

  it('matches array objects by id and recurses into each pair', () => {
    const original = { users: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] }
    const modified = { users: [{ id: 2, name: 'B' }, { id: 1, name: 'A2' }, { id: 3, name: 'C' }] }
    expect(diff(original, modified)).toEqual({
      pluginId: 'json', status: 'ok', changes: [
        { path: 'users[0].name', type: 'modified', oldValue: 'A', newValue: 'A2' },
        { path: 'users[2]', type: 'added', newValue: { id: 3, name: 'C' } },
      ],
    })
  })

  it('matches array objects by key when id is absent', () => {
    const original = { rows: [{ key: 'a', v: 1 }, { key: 'b', v: 2 }] }
    const modified = { rows: [{ key: 'b', v: 2 }, { key: 'a', v: 9 }] }
    expect(diff(original, modified).changes).toEqual([
      { path: 'rows[0].v', type: 'modified', oldValue: 1, newValue: 9 },
    ])
  })

  it('falls back to index comparison when objects lack ids', () => {
    const original = { rows: [{ name: 'A' }, { name: 'B' }] }
    const modified = { rows: [{ name: 'A' }, { name: 'B2' }, { name: 'C' }] }
    expect(diff(original, modified)).toEqual({
      pluginId: 'json', status: 'ok', changes: [
        { path: 'rows[1].name', type: 'modified', oldValue: 'B', newValue: 'B2' },
        { path: 'rows[2]', type: 'added', newValue: { name: 'C' } },
      ],
    })
  })

  it('reports a parse failure as a single error change', () => {
    const result = jsonPlugin.diff('{not json', '[]')
    expect(result.pluginId).toBe('json')
    expect(result.status).toBe('error')
    expect(typeof result.error).toBe('string')
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0].type).toBe('error')
  })

  it('flags primitive type flips as type-changed', () => {
    expect(diff({ port: '8080' }, { port: 8080 })).toEqual({
      pluginId: 'json', status: 'ok', changes: [
        { path: 'port', type: 'type-changed', oldValue: '8080', newValue: 8080 },
      ],
    })
  })

  it('returns zero changes for identical JSON', () => {
    const value = { a: [1, 2], b: { c: 'x' }, d: null, e: true }
    expect(diff(value, structuredClone(value))).toEqual({
      pluginId: 'json', status: 'ok', changes: [],
    })
  })
})
