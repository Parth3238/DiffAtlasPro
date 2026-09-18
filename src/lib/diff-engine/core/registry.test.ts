import { describe, expect, it } from 'vitest'
import { jsonPlugin } from '../plugins/json.ts'
import { csvPlugin } from '../plugins/csv.ts'
import { yamlPlugin } from '../plugins/yaml.ts'
import { imagePlugin } from '../plugins/image.ts'
import { detectFileType, registerPlugin, registry } from './registry.ts'

describe('plugin registry', () => {
  it('routes JSON inputs to the registered JSON plugin', () => {
    const original = JSON.stringify({ name: 'Atlas', version: 1 })
    const modified = JSON.stringify({ name: 'Atlas', version: 2 })
    expect(detectFileType('original.json', original)).toBe('json')
    expect(detectFileType('modified.json', modified)).toBe('json')
    expect(registry.get('json')).toBe(jsonPlugin)
    expect(jsonPlugin.diff(original, modified)).toEqual({
      pluginId: 'json',
      status: 'ok',
      changes: [{ path: 'version', type: 'modified', oldValue: 1, newValue: 2 }],
    })
  })

  it('detects each supported file type', () => {
    expect(detectFileType('data.csv', 'a,b\n1,2\n')).toBe('csv')
    expect(detectFileType('config.yaml', '')).toBe('yaml')
    expect(detectFileType('config.yml', 'name: Atlas\n')).toBe('yaml')
    expect(detectFileType('', 'name: Atlas\nversion: 2\n')).toBe('yaml')
    expect(detectFileType('photo.png', '')).toBe('image')
    expect(detectFileType('notes.txt', 'just some prose')).toBe('unknown')
    expect(registry.get('csv')).toBe(csvPlugin)
    expect(registry.get('yaml')).toBe(yamlPlugin)
    expect(registry.get('image')).toBe(imagePlugin)
  })

  it('supports registering custom plugins', () => {
    const stub = {
      id: 'stub',
      matches: () => false,
      diff: () => ({ pluginId: 'stub', status: 'not-implemented' as const, changes: [] }),
    }
    registerPlugin('stub', stub)
    expect(registry.get('stub')).toBe(stub)
    registry.delete('stub')
  })
})
