import { describe, expect, it } from 'vitest'
import {
  decodeShareHash,
  encodeShareLink,
  SHARE_HASH_PREFIX,
  SHARE_SIZE_LIMIT,
  type SharePayload,
} from './shareLinks.ts'

const payload: SharePayload = {
  v: 1,
  fileTypeA: 'json',
  contentA: '{"a":1}',
  fileTypeB: 'json',
  contentB: '{"a":2}',
  nameA: 'a.json',
  nameB: 'b.json',
}

describe('shareLinks', () => {
  it('round-trips a payload through the URL hash', () => {
    const encoded = encodeShareLink(payload, 'https://example.com/app')
    expect('url' in encoded).toBe(true)
    if (!('url' in encoded)) return
    expect(encoded.url.startsWith(`https://example.com/app${SHARE_HASH_PREFIX}`)).toBe(true)
    const hash = encoded.url.slice(encoded.url.indexOf('#'))
    expect(decodeShareHash(hash)).toEqual(payload)
  })

  it('refuses payloads over the size limit instead of a broken URL', () => {
    // Pseudo-random content defeats compression, so the payload stays large.
    let seed = 123456789
    const chars: string[] = []
    for (let i = 0; i < SHARE_SIZE_LIMIT + 5000; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      chars.push(String.fromCharCode(33 + (seed % 94)))
    }
    const big: SharePayload = { ...payload, contentA: chars.join('') }
    expect(encodeShareLink(big, 'https://example.com')).toEqual({ error: 'too-large' })
  })

  it('rejects missing, truncated, and foreign hashes', () => {
    expect(decodeShareHash('')).toBeNull()
    expect(decodeShareHash('#other=123')).toBeNull()
    expect(decodeShareHash(`${SHARE_HASH_PREFIX}%%%not-valid%%%`)).toBeNull()
    const encoded = encodeShareLink(payload, 'https://example.com')
    if (!('url' in encoded)) throw new Error('expected url')
    const hash = encoded.url.slice(encoded.url.indexOf('#'))
    expect(decodeShareHash(`${hash.slice(0, 12)}corrupted`)).toBeNull()
  })

  it('rejects payloads with missing content', () => {
    const encoded = encodeShareLink({ ...payload, contentB: '' }, 'https://example.com')
    expect('url' in encoded).toBe(true)
    if (!('url' in encoded)) return
    expect(decodeShareHash(encoded.url.slice(encoded.url.indexOf('#')))).toBeNull()
  })
})
