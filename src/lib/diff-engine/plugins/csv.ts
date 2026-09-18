import Papa from 'papaparse'
import { diffByLcs, type LcsOp } from '../core/lcs.ts'
import type { DiffChange, DiffPlugin, DiffResult } from '../core/types.ts'

/** Minimum cell-similarity for two rows to be treated as the same row. */
export const FUZZY_MATCH_THRESHOLD = 0.7

type CsvRow = Record<string, string>

interface ParsedCsv {
  headers: string[];
  rows: CsvRow[];
}

function parseCsvTable(content: string): ParsedCsv {
  const parsed = Papa.parse<Record<string, unknown>>(content, {
    header: true,
    skipEmptyLines: 'greedy',
  })
  const headers = parsed.meta.fields ?? []
  if (headers.length === 0) {
    throw new Error('CSV has no header row')
  }
  const rows: CsvRow[] = (parsed.data as Record<string, unknown>[]).map((record) => {
    const row: CsvRow = {}
    for (const header of headers) {
      const value = record[header]
      row[header] = value === undefined || value === null ? '' : String(value)
    }
    return row
  })
  return { headers, rows }
}

function unionHeaders(a: readonly string[], b: readonly string[]): string[] {
  const seen = new Set<string>(a)
  const out = [...a]
  for (const header of b) {
    if (!seen.has(header)) {
      seen.add(header)
      out.push(header)
    }
  }
  return out
}

function isColumnUnique(rows: readonly CsvRow[], column: string): boolean {
  if (rows.length === 0) return false
  const seen = new Set<string>()
  for (const row of rows) {
    const value = row[column] ?? ''
    if (value === '' || seen.has(value)) return false
    seen.add(value)
  }
  return true
}

function keyNameRank(name: string): number {
  const lowered = name.trim().toLowerCase()
  if (lowered === 'id') return 0
  if (lowered === 'key') return 1
  if (lowered === 'email') return 2
  return 3
}

/**
 * Finds a shared column whose values are non-empty and unique in both tables,
 * so rows can be matched by key even when reordered. Id-like names win ties.
 */
export function findKeyColumn(
  headersA: readonly string[],
  rowsA: readonly CsvRow[],
  headersB: readonly string[],
  rowsB: readonly CsvRow[],
): string | null {
  const inB = new Set(headersB)
  const candidates = headersA.filter((header) => inB.has(header))
  candidates.sort((a, b) => keyNameRank(a) - keyNameRank(b))
  for (const candidate of candidates) {
    if (isColumnUnique(rowsA, candidate) && isColumnUnique(rowsB, candidate)) {
      return candidate
    }
  }
  return null
}

/** Fraction of columns with equal cell values, over the shared header union. */
export function rowSimilarity(a: CsvRow, b: CsvRow, headers: readonly string[]): number {
  if (headers.length === 0) return 0
  let matches = 0
  for (const header of headers) {
    if ((a[header] ?? '') === (b[header] ?? '')) matches++
  }
  return matches / headers.length
}

function rowsExactlyEqual(a: CsvRow, b: CsvRow, headers: readonly string[]): boolean {
  return headers.every((header) => (a[header] ?? '') === (b[header] ?? ''))
}

interface RowPairs {
  aToB: Map<number, number>;
  bToA: Map<number, number>;
}

function pairByKey(rowsA: readonly CsvRow[], rowsB: readonly CsvRow[], key: string): RowPairs {
  const bIndexByKey = new Map<string, number>()
  rowsB.forEach((row, index) => {
    const value = row[key] ?? ''
    if (!bIndexByKey.has(value)) bIndexByKey.set(value, index)
  })
  const aToB = new Map<number, number>()
  const bToA = new Map<number, number>()
  rowsA.forEach((row, aIndex) => {
    const bIndex = bIndexByKey.get(row[key] ?? '')
    if (bIndex !== undefined && !bToA.has(bIndex)) {
      aToB.set(aIndex, bIndex)
      bToA.set(bIndex, aIndex)
    }
  })
  return { aToB, bToA }
}

/**
 * Greedy best-first pairing: every candidate pair at or above the threshold is
 * ranked by score, and each row is used at most once. Leftovers become pure
 * additions/removals.
 */
function pairByFuzzy(
  rowsA: readonly CsvRow[],
  rowsB: readonly CsvRow[],
  headers: readonly string[],
  threshold: number = FUZZY_MATCH_THRESHOLD,
): RowPairs {
  const candidates: { a: number; b: number; score: number }[] = []
  for (let a = 0; a < rowsA.length; a++) {
    for (let b = 0; b < rowsB.length; b++) {
      const score = rowSimilarity(rowsA[a], rowsB[b], headers)
      if (score >= threshold) candidates.push({ a, b, score })
    }
  }
  candidates.sort((x, y) => y.score - x.score || x.a - y.a || x.b - y.b)
  const aToB = new Map<number, number>()
  const bToA = new Map<number, number>()
  for (const { a, b } of candidates) {
    if (!aToB.has(a) && !bToA.has(b)) {
      aToB.set(a, b)
      bToA.set(b, a)
    }
  }
  return { aToB, bToA }
}

function diffCells(
  rowA: CsvRow,
  rowB: CsvRow,
  headers: readonly string[],
  aIndex: number,
  changes: DiffChange[],
): void {
  for (const column of headers) {
    const oldValue = rowA[column] ?? ''
    const newValue = rowB[column] ?? ''
    changes.push(
      oldValue === newValue
        ? { path: `row[${aIndex}].${column}`, type: 'unchanged', oldValue, newValue }
        : { path: `row[${aIndex}].${column}`, type: 'modified', oldValue, newValue },
    )
  }
}

/**
 * Walks the minimal LCS script so pure reorderings resolve to their matched
 * pairs (cell diffs) instead of whole-row add/remove noise. Indices that LCS
 * reports as deleted/inserted but that do have a match are still diffed
 * cell-by-cell; only truly unmatched rows become 'removed'/'added'.
 */
function emitRowDiffs(
  ops: LcsOp[],
  rowsA: readonly CsvRow[],
  rowsB: readonly CsvRow[],
  headers: readonly string[],
  pairs: RowPairs,
  changes: DiffChange[],
): void {
  const emittedA = new Set<number>()
  const emittedB = new Set<number>()
  const emitPair = (aIndex: number, bIndex: number) => {
    emittedA.add(aIndex)
    emittedB.add(bIndex)
    diffCells(rowsA[aIndex], rowsB[bIndex], headers, aIndex, changes)
  }
  for (const op of ops) {
    if (op.op === 'equal') {
      emitPair(op.aIndex, op.bIndex)
    } else if (op.op === 'delete') {
      const bIndex = pairs.aToB.get(op.aIndex)
      if (bIndex !== undefined) {
        if (!emittedB.has(bIndex)) emitPair(op.aIndex, bIndex)
      } else {
        changes.push({ path: `row[${op.aIndex}]`, type: 'removed', oldValue: rowsA[op.aIndex] })
      }
    } else {
      const aIndex = pairs.bToA.get(op.bIndex)
      if (aIndex !== undefined) {
        if (!emittedA.has(aIndex)) emitPair(aIndex, op.bIndex)
      } else {
        changes.push({ path: `row[${op.bIndex}]`, type: 'added', newValue: rowsB[op.bIndex] })
      }
    }
  }
}

function errorResult(original: string, modified: string, message: string): DiffResult {
  return {
    pluginId: 'csv',
    status: 'error',
    error: message,
    changes: [{ type: 'error', path: '$', oldValue: original, newValue: modified }],
  }
}

export const csvPlugin: DiffPlugin = {
  id: 'csv',
  matches(filename, content) {
    if (/\.(csv|tsv)$/i.test(filename)) return true
    const parsed = Papa.parse<string[]>(content.trim(), { skipEmptyLines: 'greedy' })
    const width = parsed.data[0]?.length ?? 0
    return parsed.errors.length === 0 && parsed.data.length >= 2 && width >= 2
      && parsed.data.every((row) => row.length === width)
  },
  diff(original: string, modified: string): DiffResult {
    let tableA: ParsedCsv
    let tableB: ParsedCsv
    try {
      tableA = parseCsvTable(original)
      tableB = parseCsvTable(modified)
    } catch (error) {
      return errorResult(original, modified, (error as Error).message)
    }

    const headers = unionHeaders(tableA.headers, tableB.headers)
    const key = findKeyColumn(tableA.headers, tableA.rows, tableB.headers, tableB.rows)

    const pairs =
      key !== null
        ? pairByKey(tableA.rows, tableB.rows, key)
        : pairByFuzzy(tableA.rows, tableB.rows, headers)
    const equals =
      key !== null
        ? (a: CsvRow, b: CsvRow) => (a[key] ?? '') === (b[key] ?? '')
        : (a: CsvRow, b: CsvRow) => rowsExactlyEqual(a, b, headers)

    const changes: DiffChange[] = []
    emitRowDiffs(diffByLcs(tableA.rows, tableB.rows, equals), tableA.rows, tableB.rows, headers, pairs, changes)
    return { pluginId: 'csv', status: 'ok', changes }
  },
}
