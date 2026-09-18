import { describe, expect, it } from 'vitest'
import {
  BLOCK_SIZE,
  computeMatchedSize,
  diffImageData,
  imagePlugin,
  type RgbaBuffer,
} from './image.ts'

function solid(width: number, height: number, r: number, g: number, b: number): RgbaBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = 255
  }
  return { data, width, height }
}

function paint(buffer: RgbaBuffer, x: number, y: number, w: number, h: number, r: number, g: number, b: number): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const offset = ((y + dy) * buffer.width + (x + dx)) * 4
      buffer.data[offset] = r
      buffer.data[offset + 1] = g
      buffer.data[offset + 2] = b
    }
  }
}

describe('diffImageData', () => {
  it('reports zero change for identical buffers', () => {
    const result = diffImageData(solid(64, 48, 10, 20, 30), solid(64, 48, 10, 20, 30))
    expect(result.changedPixelCount).toBe(0)
    expect(result.changedBlockCount).toBe(0)
    expect(result.regions).toEqual([])
    expect(result.percentChanged).toBe(0)
  })

  it('ignores sub-tolerance anti-aliasing noise', () => {
    const a = solid(64, 48, 100, 100, 100)
    const b = solid(64, 48, 100, 100, 100)
    for (let i = 0; i < b.data.length; i += 4) {
      b.data[i] += 3
      b.data[i + 1] -= 2
      b.data[i + 2] += 4
    }
    const result = diffImageData(a, b)
    expect(result.changedPixelCount).toBe(0)
    expect(result.changedBlockCount).toBe(0)
    expect(result.regions).toEqual([])
  })

  it('flags a changed rect with a block-snapped bounding box', () => {
    const a = solid(256, 192, 20, 20, 20)
    const b = solid(256, 192, 20, 20, 20)
    paint(b, 64, 48, 48, 32, 200, 30, 30)
    const result = diffImageData(a, b)
    expect(result.changedPixelCount).toBe(48 * 32)
    // x 64..111 -> blocks 4..6, y 48..79 -> blocks 3..4
    expect(result.changedBlockCount).toBe(3 * 2)
    expect(result.regions).toHaveLength(1)
    expect(result.regions[0]).toMatchObject({ x: 64, y: 48, width: 48, height: 32 })
    expect(result.percentChanged).toBeCloseTo((6 / (16 * 12)) * 100, 5)
    expect(result.mask[(48 * 256 + 64)]).toBe(1)
    expect(result.mask[0]).toBe(0)
  })

  it('merges adjacent blocks into one region and keeps distant ones apart', () => {
    const a = solid(256, 64, 0, 0, 0)
    const close = solid(256, 64, 0, 0, 0)
    paint(close, 0, 0, 16, 16, 255, 0, 0)
    paint(close, 16, 0, 16, 16, 255, 0, 0)
    expect(diffImageData(a, close).regions).toHaveLength(1)

    const far = solid(256, 64, 0, 0, 0)
    paint(far, 0, 0, 16, 16, 255, 0, 0)
    paint(far, 128, 0, 16, 16, 255, 0, 0)
    const result = diffImageData(a, far)
    expect(result.regions).toHaveLength(2)
    expect(result.regions[0]).toMatchObject({ x: 0, y: 0, width: 16, height: 16 })
    expect(result.regions[1]).toMatchObject({ x: 128, y: 0, width: 16, height: 16 })
  })

  it('throws on dimension mismatch', () => {
    expect(() => diffImageData(solid(8, 8, 0, 0, 0), solid(4, 8, 0, 0, 0))).toThrow(
      /dimension mismatch/,
    )
  })

  it('uses 16px blocks by default', () => {
    expect(BLOCK_SIZE).toBe(16)
  })
})

describe('computeMatchedSize', () => {
  it('keeps equal sizes untouched', () => {
    expect(computeMatchedSize(400, 300, 400, 300)).toMatchObject({
      width: 400,
      height: 300,
      resized: false,
      resizedSide: 'none',
    })
  })

  it('downscales the larger image to the smaller', () => {
    expect(computeMatchedSize(800, 600, 400, 300)).toMatchObject({
      width: 400,
      height: 300,
      resized: true,
      resizedSide: 'original',
    })
    expect(computeMatchedSize(400, 300, 800, 600).resizedSide).toBe('modified')
  })
})

describe('imagePlugin.diff', () => {
  it('returns zero changes for identical payloads', () => {
    const url = 'data:image/png;base64,AAAA'
    expect(imagePlugin.diff(url, url)).toEqual({ pluginId: 'image', status: 'ok', changes: [] })
  })

  it('reports differing byte sizes without canvas', () => {
    const result = imagePlugin.diff('data:image/png;base64,AAAA', 'data:image/png;base64,AAAAAAAA')
    expect(result.status).toBe('ok')
    expect(result.changes.some((c) => c.path === 'image.bytes' && c.type === 'modified')).toBe(true)
  })

  it('reports mime changes', () => {
    const result = imagePlugin.diff('data:image/png;base64,AAAA', 'data:image/jpeg;base64,AAAA')
    expect(result.changes.some((c) => c.path === 'image.mime')).toBe(true)
  })

  it('flags pixel-content differences at equal metadata', () => {
    const result = imagePlugin.diff('data:image/png;base64,AAAA', 'data:image/png;base64,AAAB')
    expect(result.changes.some((c) => c.path === 'image.pixels')).toBe(true)
  })

  it('errors on empty or non-image input', () => {
    expect(imagePlugin.diff('', 'data:image/png;base64,AAAA').status).toBe('error')
    expect(imagePlugin.diff('hello', 'world').status).toBe('error')
  })
})
