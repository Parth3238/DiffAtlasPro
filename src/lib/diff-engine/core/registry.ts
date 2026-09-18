import { jsonPlugin } from '../plugins/json.ts'
import { csvPlugin } from '../plugins/csv.ts'
import { yamlPlugin } from '../plugins/yaml.ts'
import { imagePlugin } from '../plugins/image.ts'
import type { DiffPlugin, FileType } from './types.ts'

export const registry = new Map<string, DiffPlugin>([
  ['json', jsonPlugin],
  ['csv', csvPlugin],
  ['yaml', yamlPlugin],
  ['image', imagePlugin],
])

export function registerPlugin(fileType: string, plugin: DiffPlugin): void {
  registry.set(fileType, plugin)
}

export function detectFileType(filename: string, content: string): FileType {
  if (/\.json$/i.test(filename)) return 'json'
  if (/\.(csv|tsv)$/i.test(filename)) return 'csv'
  if (/\.(yaml|yml)$/i.test(filename)) return 'yaml'
  if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(filename)) return 'image'
  if (imagePlugin.matches('', content)) return 'image'
  if (jsonPlugin.matches('', content)) return 'json'
  // JSON is valid YAML, so JSON wins when both match.
  if (yamlPlugin.matches('', content)) return 'yaml'
  if (csvPlugin.matches('', content)) return 'csv'
  return 'unknown'
}
