import { JSON_SCHEMA, load } from 'js-yaml'
import { jsonPlugin } from './json.ts'
import type { DiffPlugin, DiffResult } from '../core/types.ts'

type YamlParse = { ok: true; value: unknown } | { ok: false; error: string }

function parseYaml(content: string): YamlParse {
  if (!content.trim()) return { ok: false, error: 'Empty YAML input' }
  try {
    // JSON_SCHEMA keeps semantics aligned with the JSON tree-diff: no implicit
    // timestamps or other exotic types, so plain strings stay strings.
    const value = load(content, { schema: JSON_SCHEMA })
    if (value === undefined) return { ok: false, error: 'Empty YAML input' }
    return { ok: true, value }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid YAML' }
  }
}

function errorResult(original: string, modified: string, message: string): DiffResult {
  return {
    pluginId: 'yaml',
    status: 'error',
    error: message,
    changes: [{ type: 'error', path: '$', oldValue: original, newValue: modified }],
  }
}

export const yamlPlugin: DiffPlugin = {
  id: 'yaml',
  matches(filename, content) {
    if (/\.(yaml|yml)$/i.test(filename)) return true
    if (!content.trim()) return false
    const parsed = parseYaml(content)
    // Scalars (plain prose, bare numbers) are not treated as YAML documents
    // so they cannot shadow CSV/unknown detection.
    return parsed.ok && typeof parsed.value === 'object' && parsed.value !== null
  },
  diff(original: string, modified: string): DiffResult {
    const a = parseYaml(original)
    if (!a.ok) return errorResult(original, modified, a.error)
    const b = parseYaml(modified)
    if (!b.ok) return errorResult(original, modified, b.error)
    // Reuse the JSON structural diff on the parsed structures — YAML diff is
    // just "parse to object, then run the same tree-diff as JSON".
    const result = jsonPlugin.diff(JSON.stringify(a.value), JSON.stringify(b.value))
    return { ...result, pluginId: 'yaml' }
  },
}
