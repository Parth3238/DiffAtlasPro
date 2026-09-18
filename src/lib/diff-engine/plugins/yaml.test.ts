import { describe, expect, it } from 'vitest'
import { yamlPlugin } from './yaml.ts'

const diff = (original: string, modified: string) => yamlPlugin.diff(original, modified)

describe('YAML structural diff', () => {
  it('compares flat keys and omits unchanged values', () => {
    expect(
      diff('same: true\ngone: 1\nname: old\n', 'same: true\nname: new\nextra: 2\n'),
    ).toEqual({
      pluginId: 'yaml',
      status: 'ok',
      changes: [
        { path: 'gone', type: 'removed', oldValue: 1 },
        { path: 'name', type: 'modified', oldValue: 'old', newValue: 'new' },
        { path: 'extra', type: 'added', newValue: 2 },
      ],
    })
  })

  it('builds dotted paths for nested mapping changes', () => {
    expect(
      diff(
        'user:\n  address:\n    city: Berlin\n    zip: "10115"\n',
        'user:\n  address:\n    city: Munich\n    zip: "10115"\n',
      ),
    ).toEqual({
      pluginId: 'yaml',
      status: 'ok',
      changes: [
        { path: 'user.address.city', type: 'modified', oldValue: 'Berlin', newValue: 'Munich' },
      ],
    })
  })

  it('uses LCS so reordered sequences produce a minimal diff', () => {
    expect(diff('[1, 2, 3, 4]\n', '[2, 1, 3, 4]\n').changes).toEqual([
      { path: '[0]', type: 'removed', oldValue: 1 },
      { path: '[1]', type: 'added', newValue: 1 },
    ])
  })

  it('matches sequence objects by id and recurses into each pair', () => {
    const original = 'users:\n  - id: 1\n    name: A\n  - id: 2\n    name: B\n'
    const modified = 'users:\n  - id: 2\n    name: B\n  - id: 1\n    name: A2\n  - id: 3\n    name: C\n'
    expect(diff(original, modified)).toEqual({
      pluginId: 'yaml',
      status: 'ok',
      changes: [
        { path: 'users[0].name', type: 'modified', oldValue: 'A', newValue: 'A2' },
        { path: 'users[2]', type: 'added', newValue: { id: 3, name: 'C' } },
      ],
    })
  })

  it('flags quoted-vs-bare scalars as type-changed', () => {
    expect(diff("port: '8080'\n", 'port: 8080\n')).toEqual({
      pluginId: 'yaml',
      status: 'ok',
      changes: [{ path: 'port', type: 'type-changed', oldValue: '8080', newValue: 8080 }],
    })
  })

  it('returns zero changes for identical YAML', () => {
    const doc = 'a:\n  - 1\n  - 2\nb:\n  c: x\n'
    expect(diff(doc, doc)).toEqual({ pluginId: 'yaml', status: 'ok', changes: [] })
  })

  it('reports a parse failure as a single error change', () => {
    const result = diff('key: [unclosed\n', 'key: 1\n')
    expect(result.pluginId).toBe('yaml')
    expect(result.status).toBe('error')
    expect(typeof result.error).toBe('string')
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0].type).toBe('error')
  })

  it('detects YAML by extension and structured content, not scalars', () => {
    expect(yamlPlugin.matches('config.yaml', '')).toBe(true)
    expect(yamlPlugin.matches('config.yml', 'anything')).toBe(true)
    expect(yamlPlugin.matches('', 'name: Atlas\nversion: 2\n')).toBe(true)
    expect(yamlPlugin.matches('', 'just some prose')).toBe(false)
    expect(yamlPlugin.matches('', '')).toBe(false)
  })
})
