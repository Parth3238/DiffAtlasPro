import type { DiffPlugin, DiffResult } from '../core/types.ts'

/**
 * Sum of absolute per-channel RGB differences (0–765) above which a pixel
 * counts as changed. ~16 levels per channel on average, so JPEG ringing and
 * anti-aliasing wobble stay silent while real edits stand out.
 */
export const PIXEL_TOLERANCE = 48

/** Block edge length in pixels for the structural (block-average) pass. */
export const BLOCK_SIZE = 16

/**
 * Same sum-of-abs-diffs metric applied to per-block average colors. Averaging
 * suppresses single-pixel noise, so this threshold is tighter than the pixel
 * one; a block only flips when its region genuinely shifted color.
 */
export const BLOCK_THRESHOLD = 36

export interface RgbaBuffer {
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface ChangedRegion {
  /** Pixel-space bounding box snapped to the block grid. */
  x: number
  y: number
  width: number
  height: number
  /** Block-space box, useful for overlays. */
  blockX: number
  blockY: number
  blockWidth: number
  blockHeight: number
}

export interface ImageDiff {
  width: number
  height: number
  /** 1 byte per pixel: 1 = changed, 0 = same. Row-major. */
  mask: Uint8Array
  changedPixelCount: number
  changedPixelPercent: number
  blockCols: number
  blockRows: number
  /** Row-major block flags, length blockCols * blockRows. */
  changedBlocks: Uint8Array
  changedBlockCount: number
  regions: ChangedRegion[]
  /** % of image changed, based on the block-diff calculation. */
  percentChanged: number
}

export interface ImageDiffOptions {
  pixelTolerance?: number
  blockSize?: number
  blockThreshold?: number
}

export interface MatchedSize {
  width: number
  height: number
  resized: boolean
  /** Which input was downscaled, or 'none' when sizes already match. */
  resizedSide: 'original' | 'modified' | 'none'
  originalWidth: number
  originalHeight: number
  modifiedWidth: number
  modifiedHeight: number
}

/**
 * Target dimensions for comparison: the smaller of each axis, so the larger
 * image is downscaled to match (aspect may change when axes disagree — the
 * caller reports that via `resized`).
 */
export function computeMatchedSize(
  originalWidth: number,
  originalHeight: number,
  modifiedWidth: number,
  modifiedHeight: number,
): MatchedSize {
  const width = Math.min(originalWidth, modifiedWidth)
  const height = Math.min(originalHeight, modifiedHeight)
  const resized = width !== originalWidth || height !== originalHeight ||
    width !== modifiedWidth || height !== modifiedHeight
  const resizedSide: MatchedSize['resizedSide'] = !resized
    ? 'none'
    : originalWidth * originalHeight >= modifiedWidth * modifiedHeight
      ? 'original'
      : 'modified'
  return {
    width,
    height,
    resized,
    resizedSide,
    originalWidth,
    originalHeight,
    modifiedWidth,
    modifiedHeight,
  }
}

function pixelDistance(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  index: number,
): number {
  return (
    Math.abs(a[index] - b[index]) +
    Math.abs(a[index + 1] - b[index + 1]) +
    Math.abs(a[index + 2] - b[index + 2])
  )
}

/**
 * Groups changed blocks into contiguous (4-connected) regions and returns
 * pixel-space bounding boxes snapped to the block grid.
 */
export function findChangedRegions(
  changedBlocks: Uint8Array,
  blockCols: number,
  blockRows: number,
  blockSize: number,
  imageWidth: number,
  imageHeight: number,
): ChangedRegion[] {
  const visited = new Uint8Array(changedBlocks.length)
  const regions: ChangedRegion[] = []
  const stack: number[] = []

  for (let start = 0; start < changedBlocks.length; start++) {
    if (!changedBlocks[start] || visited[start]) continue
    let minBX = blockCols
    let minBY = blockRows
    let maxBX = -1
    let maxBY = -1
    stack.push(start)
    visited[start] = 1
    while (stack.length > 0) {
      const cell = stack.pop() as number
      const bx = cell % blockCols
      const by = Math.floor(cell / blockCols)
      if (bx < minBX) minBX = bx
      if (by < minBY) minBY = by
      if (bx > maxBX) maxBX = bx
      if (by > maxBY) maxBY = by
      if (bx > 0) {
        const next = cell - 1
        if (changedBlocks[next] && !visited[next]) {
          visited[next] = 1
          stack.push(next)
        }
      }
      if (bx < blockCols - 1) {
        const next = cell + 1
        if (changedBlocks[next] && !visited[next]) {
          visited[next] = 1
          stack.push(next)
        }
      }
      if (by > 0) {
        const next = cell - blockCols
        if (changedBlocks[next] && !visited[next]) {
          visited[next] = 1
          stack.push(next)
        }
      }
      if (by < blockRows - 1) {
        const next = cell + blockCols
        if (changedBlocks[next] && !visited[next]) {
          visited[next] = 1
          stack.push(next)
        }
      }
    }
    const x = minBX * blockSize
    const y = minBY * blockSize
    regions.push({
      x,
      y,
      width: Math.min((maxBX + 1) * blockSize, imageWidth) - x,
      height: Math.min((maxBY + 1) * blockSize, imageHeight) - y,
      blockX: minBX,
      blockY: minBY,
      blockWidth: maxBX - minBX + 1,
      blockHeight: maxBY - minBY + 1,
    })
  }

  regions.sort((a, b) => a.y - b.y || a.x - b.x)
  return regions
}

/**
 * Pixel-level diff plus structural block pass. Both buffers must already share
 * dimensions (the caller matches sizes first). Alpha is ignored so transparent
 * vs opaque encoding differences don't count as edits.
 */
export function diffImageData(a: RgbaBuffer, b: RgbaBuffer, options: ImageDiffOptions = {}): ImageDiff {
  const { width, height } = a
  if (b.width !== width || b.height !== height) {
    throw new Error(`Image dimension mismatch: ${width}x${height} vs ${b.width}x${b.height}`)
  }
  if (a.data.length < width * height * 4 || b.data.length < width * height * 4) {
    throw new Error('Image buffer is smaller than its declared dimensions')
  }
  const pixelTolerance = options.pixelTolerance ?? PIXEL_TOLERANCE
  const blockSize = options.blockSize ?? BLOCK_SIZE
  const blockThreshold = options.blockThreshold ?? BLOCK_THRESHOLD

  const mask = new Uint8Array(width * height)
  let changedPixelCount = 0
  for (let i = 0; i < width * height; i++) {
    const offset = i * 4
    if (pixelDistance(a.data, b.data, offset) > pixelTolerance) {
      mask[i] = 1
      changedPixelCount++
    }
  }

  const blockCols = Math.ceil(width / blockSize)
  const blockRows = Math.ceil(height / blockSize)
  const changedBlocks = new Uint8Array(blockCols * blockRows)
  let changedBlockCount = 0
  for (let by = 0; by < blockRows; by++) {
    for (let bx = 0; bx < blockCols; bx++) {
      let rA = 0
      let gA = 0
      let bA = 0
      let rB = 0
      let gB = 0
      let bB = 0
      let count = 0
      const yEnd = Math.min((by + 1) * blockSize, height)
      const xEnd = Math.min((bx + 1) * blockSize, width)
      for (let y = by * blockSize; y < yEnd; y++) {
        for (let x = bx * blockSize; x < xEnd; x++) {
          const offset = (y * width + x) * 4
          rA += a.data[offset]
          gA += a.data[offset + 1]
          bA += a.data[offset + 2]
          rB += b.data[offset]
          gB += b.data[offset + 1]
          bB += b.data[offset + 2]
          count++
        }
      }
      const distance =
        Math.abs(rA - rB) / count + Math.abs(gA - gB) / count + Math.abs(bA - bB) / count
      if (distance > blockThreshold) {
        changedBlocks[by * blockCols + bx] = 1
        changedBlockCount++
      }
    }
  }

  const totalBlocks = blockCols * blockRows
  const regions = findChangedRegions(changedBlocks, blockCols, blockRows, blockSize, width, height)
  return {
    width,
    height,
    mask,
    changedPixelCount,
    changedPixelPercent: (changedPixelCount / (width * height)) * 100,
    blockCols,
    blockRows,
    changedBlocks,
    changedBlockCount,
    regions,
    percentChanged: totalBlocks === 0 ? 0 : (changedBlockCount / totalBlocks) * 100,
  }
}

interface DataUrlMeta {
  mime: string
  bytes: number
}

function parseDataUrlMeta(content: string): DataUrlMeta | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s.exec(content.trim())
  if (!match) return null
  const payload = match[2].replace(/\s/g, '')
  // Base64 length -> byte length without decoding the whole payload.
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return { mime: match[1].toLowerCase(), bytes: Math.floor((payload.length * 3) / 4) - padding }
}

function errorResult(original: string, modified: string, message: string): DiffResult {
  return {
    pluginId: 'image',
    status: 'error',
    error: message,
    changes: [{ type: 'error', path: '$', oldValue: original, newValue: modified }],
  }
}

export const imagePlugin: DiffPlugin = {
  id: 'image',
  matches(filename, content) {
    if (/\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i.test(filename)) return true
    if (/^data:image\//i.test(content.trim())) return true
    if (/<svg[\s>]/i.test(content)) return true
    return false
  },
  diff(original: string, modified: string): DiffResult {
    if (!original.trim() || !modified.trim()) {
      return errorResult(original, modified, 'Both images are required for comparison')
    }
    if (original === modified) {
      return { pluginId: 'image', status: 'ok', changes: [] }
    }
    // String-level fast path (worker-safe, no canvas needed): identical payloads
    // are handled above; differing metadata is reported here while the rich
    // pixel/block visual diff runs in ImageDiffView.
    const metaA = parseDataUrlMeta(original)
    const metaB = parseDataUrlMeta(modified)
    if (!metaA || !metaB) {
      return errorResult(
        original,
        modified,
        'Expected data-URL image payloads — load PNG/JPEG files to compare visually',
      )
    }
    const changes: DiffResult['changes'] = []
    if (metaA.mime !== metaB.mime) {
      changes.push({ path: 'image.mime', type: 'modified', oldValue: metaA.mime, newValue: metaB.mime })
    }
    if (metaA.bytes !== metaB.bytes) {
      changes.push({ path: 'image.bytes', type: 'modified', oldValue: metaA.bytes, newValue: metaB.bytes })
    }
    if (changes.length === 0) {
      changes.push({
        path: 'image.pixels',
        type: 'modified',
        oldValue: { bytes: metaA.bytes },
        newValue: { bytes: metaB.bytes },
      })
    }
    return { pluginId: 'image', status: 'ok', changes }
  },
}
