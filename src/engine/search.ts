import type { PalRecord } from './types.ts'

const MAX_RESULTS = 12

function isDigits(query: string): boolean {
  return /^\d+$/.test(query)
}

/** `dex` matches a digits-only query when it's the number itself or that number plus a variant letter suffix. */
function dexMatchesDigits(dex: string, query: string): boolean {
  return dex.startsWith(query) && /^[A-Z]*$/.test(dex.slice(query.length))
}

/** Names split on anything that isn't a letter/digit, so "Relaxaurus Lux" offers "relaxaurus" and "lux". */
function wordsOf(name: string): string[] {
  return name.split(/[^a-z0-9]+/i).filter((w) => w !== '')
}

function isSubsequence(name: string, query: string): boolean {
  let i = 0
  for (const ch of name) {
    if (i < query.length && ch === query[i]) i++
  }
  return i === query.length
}

/**
 * Best-match tier for `pal` against a lowercased `query`, lower is better, `null` means no match:
 * 0 exact name/dex prefix, 1 a later word starts with it, 2 substring anywhere, 3 subsequence.
 */
function tierFor(pal: PalRecord, query: string, rawQuery: string): number | null {
  const name = pal.name.toLowerCase()
  if (name.startsWith(query)) return 0
  if (isDigits(rawQuery) && dexMatchesDigits(pal.dex, rawQuery)) return 0
  if (wordsOf(name).some((w) => w.startsWith(query))) return 1
  if (name.includes(query)) return 2
  if (isSubsequence(name, query)) return 3
  return null
}

/** Ascending numeric dex, then the raw dex string (so "143" sorts before its "143B" variant), then name. */
function dexOrder(a: PalRecord, b: PalRecord): number {
  const an = parseInt(a.dex, 10)
  const bn = parseInt(b.dex, 10)
  if (an !== bn) return an - bn
  if (a.dex !== b.dex) return a.dex < b.dex ? -1 : 1
  return a.name.localeCompare(b.name)
}

/**
 * Fuzzy pal search over the dataset order: exact/word/substring/subsequence name matching plus
 * digit-string dex lookup, an optional type filter applied before ranking, ties broken by dex so
 * results are stable across calls. Empty query short-circuits to no results — the caller decides
 * what an empty search box shows (recents, everything, nothing).
 */
export function searchPals(pals: PalRecord[], query: string, typeFilter?: string[]): number[] {
  const rawQuery = query.trim()
  if (rawQuery === '') return []
  const q = rawQuery.toLowerCase()

  const pool =
    typeFilter !== undefined && typeFilter.length > 0
      ? pals.map((pal, index) => ({ pal, index })).filter(({ pal }) => pal.types.some((t) => typeFilter.includes(t)))
      : pals.map((pal, index) => ({ pal, index }))

  const ranked: Array<{ pal: PalRecord; index: number; tier: number }> = []
  for (const { pal, index } of pool) {
    const tier = tierFor(pal, q, rawQuery)
    if (tier !== null) ranked.push({ pal, index, tier })
  }

  ranked.sort((x, y) => (x.tier !== y.tier ? x.tier - y.tier : dexOrder(x.pal, y.pal)))

  return ranked.slice(0, MAX_RESULTS).map((r) => r.index)
}
