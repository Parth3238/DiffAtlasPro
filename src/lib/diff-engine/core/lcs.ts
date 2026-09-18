export type LcsOp =
  | { op: 'equal'; aIndex: number; bIndex: number }
  | { op: 'delete'; aIndex: number }
  | { op: 'insert'; bIndex: number }

/**
 * Computes a shortest insertion/deletion script using a longest common
 * subsequence. This is the quadratic DP formulation, not Myers' frontier
 * optimization. A custom equality predicate makes it reusable for CSV rows.
 *
 * dp[i][j] holds the LCS length for suffixes a[i..] and b[j..]. Empty suffixes
 * have length zero. Fill bottom-right to top-left: equal elements contribute
 * one plus the diagonal; otherwise keep the better of skipping either item.
 *
 * Backtracking starts at (0, 0): matching elements advance both indices;
 * otherwise follow the larger suffix score. Ties delete first for stable
 * output. Drain either remaining suffix so empty inputs and trailing changes
 * are preserved. Only lengths are stored in the table, never whole scripts.
 *
 * Time and table space are O(m*n); backtracking takes O(m+n) time and output
 * space. Indices refer to the original input sequences, not a mutable patch.
 */
export function diffByLcs<T>(
  a: readonly T[],
  b: readonly T[],
  equals: (x: T, y: T) => boolean = (x, y) => x === y,
): LcsOp[] {
  const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = equals(a[i], b[j])
        ? 1 + dp[i + 1][j + 1]
        : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const ops: LcsOp[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (equals(a[i], b[j])) {
      ops.push({ op: 'equal', aIndex: i++, bIndex: j++ })
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ op: 'delete', aIndex: i++ })
    } else {
      ops.push({ op: 'insert', bIndex: j++ })
    }
  }
  while (i < a.length) ops.push({ op: 'delete', aIndex: i++ })
  while (j < b.length) ops.push({ op: 'insert', bIndex: j++ })
  return ops
}
