import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from 'lz-string'
import type { FileType } from '../diff-engine/core/types.ts'

export interface SharePayload {
  v: 1
  fileTypeA: FileType
  contentA: string
  fileTypeB: FileType
  contentB: string
  nameA?: string
  nameB?: string
}

/** Compressed payloads longer than this are not put into URLs. */
export const SHARE_SIZE_LIMIT = 50_000

export const SHARE_HASH_PREFIX = '#d='

export type ShareEncodeResult = { url: string } | { error: 'too-large' }

/**
 * Compresses a diff pair (lz-string, URI-safe base64 alphabet) and embeds it
 * in the URL hash. Returns a too-large error instead of a broken URL when the
 * payload exceeds SHARE_SIZE_LIMIT.
 */
export function encodeShareLink(
  payload: SharePayload,
  baseUrl: string = typeof window !== 'undefined' ? window.location.href.split('#')[0] : '',
): ShareEncodeResult {
  const compressed = compressToEncodedURIComponent(JSON.stringify(payload))
  if (compressed.length > SHARE_SIZE_LIMIT) return { error: 'too-large' }
  return { url: `${baseUrl}${SHARE_HASH_PREFIX}${compressed}` }
}

/** Decodes a `#d=<compressed>` hash back into a payload, or null if invalid. */
export function decodeShareHash(hash: string): SharePayload | null {
  const prefix = hash.startsWith('#') ? SHARE_HASH_PREFIX : 'd='
  if (!hash.startsWith(prefix)) return null
  const compressed = hash.slice(prefix.length)
  if (!compressed) return null
  try {
    const json = decompressFromEncodedURIComponent(compressed)
    if (!json) return null
    const parsed = JSON.parse(json) as Partial<SharePayload>
    if (
      parsed?.v !== 1 ||
      typeof parsed.contentA !== 'string' ||
      typeof parsed.contentB !== 'string' ||
      !parsed.contentA ||
      !parsed.contentB
    ) {
      return null
    }
    return parsed as SharePayload
  } catch {
    return null
  }
}
