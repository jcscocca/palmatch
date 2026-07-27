import type { Dataset, MutationOutcome, MutationPair } from './types.ts'

/** Half-rounding the game's own tables use: .5 goes up. */
const r5 = (x: number): number => Math.round(2 * x + 0.5) >> 1

const RANK_ORDER = new WeakMap<Dataset, number[]>()

/**
 * Every pal, sorted by rank. Equal ranks put the higher-priority pal first, which is the one a
 * rank resolves to, so a rank group's first entry is its representative.
 */
function eligibleByRank(ds: Dataset): number[] {
  let sorted = RANK_ORDER.get(ds)
  if (sorted === undefined) {
    sorted = ds.pals
      .map((_, i) => i)
      .sort((x, y) => ds.pals[x].power - ds.pals[y].power || ds.pals[y].priority - ds.pals[x].priority)
    RANK_ORDER.set(ds, sorted)
  }
  return sorted
}

/** First position in `eligible` whose rank is at least `r`. */
function lowerBound(eligible: number[], ds: Dataset, r: number): number {
  let lo = 0
  let hi = eligible.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (ds.pals[eligible[mid]].power < r) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Walks back to the representative of the rank group holding position `i`. */
function groupStart(eligible: number[], ds: Dataset, i: number): number {
  const power = ds.pals[eligible[i]].power
  while (i > 0 && ds.pals[eligible[i - 1]].power === power) i--
  return i
}

/** The pal whose rank is closest to `r`; on a tie the higher-priority side wins, else the stronger. */
function nearestByRank(eligible: number[], ds: Dataset, r: number): number {
  const at = lowerBound(eligible, ds, r)
  const above = at < eligible.length ? eligible[at] : -1
  const below = at > 0 ? eligible[groupStart(eligible, ds, at - 1)] : -1
  if (above < 0) return below
  if (below < 0) return above
  const gapAbove = ds.pals[above].power - r
  const gapBelow = r - ds.pals[below].power
  if (gapAbove !== gapBelow) return gapAbove < gapBelow ? above : below
  return ds.pals[above].priority > ds.pals[below].priority ? above : below
}

/** The inclusive rank window a pairing rolls in: half the weaker parent's rank, plus a spread. */
function rankWindow(ds: Dataset, a: number, b: number): { lo: number; hi: number } {
  const { rankCoefficient, rankDiffPenalty, randomCoefficient } = ds.mutation
  const ra = ds.pals[a].power
  const rb = ds.pals[b].power
  const lo = Math.min(ra, rb)
  const h = r5(lo * rankCoefficient) + r5(Math.abs(ra - rb) * rankDiffPenalty)
  const p = Math.max(1, r5(lo * randomCoefficient))
  return { lo: Math.max(1, h + 1), hi: h + p }
}

/**
 * The mutation children `a` x `b` can roll, heaviest first. Ranks in the pairing's window each
 * resolve to their nearest pal, so a pal covering more of the window is likelier. The model is the
 * community estimate named in `mutation.json`, not datamined tables.
 */
export function mutationPool(ds: Dataset, a: number, b: number): MutationOutcome[] {
  const window = rankWindow(ds, a, b)
  const eligible = eligibleByRank(ds)
  const counts = new Map<number, number>()
  for (let r = window.lo; r <= window.hi; r++) {
    const child = nearestByRank(eligible, ds, r)
    counts.set(child, (counts.get(child) ?? 0) + 1)
  }
  const total = [...counts.values()].reduce((s, x) => s + x, 0)
  return [...counts].map(([child, k]) => ({ child, weight: k / total })).sort((x, y) => y.weight - x.weight)
}

/**
 * Every integer rank that resolves to `target`, or null when it resolves to nothing because a pal
 * of the same rank outranks it. Bounded by the midpoints to the neighbouring ranks, with the same
 * tie-break `nearestByRank` applies, so the two never disagree.
 */
function rankInterval(ds: Dataset, target: number): { lo: number; hi: number } | null {
  const eligible = eligibleByRank(ds)
  const power = ds.pals[target].power
  const start = groupStart(eligible, ds, eligible.indexOf(target))
  if (eligible[start] !== target) return null

  let end = start
  while (end < eligible.length && ds.pals[eligible[end]].power === power) end++

  let lo = 1
  if (start > 0) {
    const prev = eligible[groupStart(eligible, ds, start - 1)]
    const sum = power + ds.pals[prev].power
    const mid = sum >> 1
    lo = Math.max(1, sum % 2 === 0 && ds.pals[target].priority > ds.pals[prev].priority ? mid : mid + 1)
  }

  let hi = Number.MAX_SAFE_INTEGER
  if (end < eligible.length) {
    const next = eligible[end]
    const sum = power + ds.pals[next].power
    const mid = sum >> 1
    hi = sum % 2 === 0 && ds.pals[target].priority < ds.pals[next].priority ? mid - 1 : mid
  }
  return { lo, hi }
}

/** Every unordered pair whose mutation window can land on `target`. */
export function reverseMutation(ds: Dataset, target: number): MutationPair[] {
  const span = rankInterval(ds, target)
  if (span === null) return []
  const n = ds.pals.length
  const out: MutationPair[] = []
  for (let a = 0; a < n; a++) {
    for (let b = a; b < n; b++) {
      const window = rankWindow(ds, a, b)
      if (window.lo <= span.hi && window.hi >= span.lo) out.push({ a, b })
    }
  }
  return out
}
