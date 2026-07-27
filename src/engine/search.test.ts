import { describe, expect, it } from 'vitest'
import { searchPals } from './search.ts'
import type { PalRecord } from './types.ts'

function mk(id: string, name: string, dex: string, types: string[]): PalRecord {
  return { id, name, dex, types, power: 1, priority: 1, maleProb: 0.5, guaranteed: [], sprite: `/sprites/${id}.webp` }
}

// Indices 0-6 are named fixtures used to probe individual tiers and the dex-digit rule.
// Indices 7-21 are 15 pals that all rank tier 0 for "test", sorted by ascending dex (200..214),
// so slicing to the first 12 is a simple, unambiguous check.
const FIXTURE: PalRecord[] = [
  mk('lamball', 'Lamball', '1', ['normal']), // 0
  mk('cattiva', 'Cattiva', '2', ['normal']), // 1
  mk('foxparks', 'Foxparks', '14', ['fire']), // 2
  mk('relaxaurus', 'Relaxaurus', '48', ['dragon', 'water']), // 3
  mk('relaxaurus_lux', 'Relaxaurus Lux', '48B', ['dragon', 'electric']), // 4
  mk('grizzbolt', 'Grizzbolt', '68', ['electric']), // 5
  mk('blazamut', 'Blazamut', '124', ['fire', 'dragon']), // 6
  ...Array.from({ length: 15 }, (_, i) => mk(`test${i}`, `Testpal${i}`, `${200 + i}`, ['normal'])), // 7-21
]

const i = {
  lamball: 0,
  cattiva: 1,
  foxparks: 2,
  relaxaurus: 3,
  relaxaurusLux: 4,
  grizzbolt: 5,
  blazamut: 6,
}

describe('searchPals', () => {
  it('returns nothing for an empty (or whitespace-only) query', () => {
    expect(searchPals(FIXTURE, '')).toEqual([])
    expect(searchPals(FIXTURE, '   ')).toEqual([])
  })

  it('ranks tiers 0 (name prefix) > 2 (substring) ahead of each other, ties broken by dex', () => {
    // "la": tier 0 = Lamball; tier 2 = Relaxaurus (48), Relaxaurus Lux (48, variant), Blazamut (124).
    expect(searchPals(FIXTURE, 'la')).toEqual([i.lamball, i.relaxaurus, i.relaxaurusLux, i.blazamut])
  })

  it('ranks a word-boundary prefix (tier 1) above plain substring matches', () => {
    // "lux" only starts the second word of "Relaxaurus Lux" - not a name prefix, not a substring
    // hit anywhere else in the fixture.
    expect(searchPals(FIXTURE, 'lux')).toEqual([i.relaxaurusLux])
  })

  it('is case-insensitive', () => {
    expect(searchPals(FIXTURE, 'LAMBALL')).toEqual([i.lamball])
    expect(searchPals(FIXTURE, 'Lux')).toEqual([i.relaxaurusLux])
  })

  it('falls back to subsequence matching (tier 3)', () => {
    // f-o-x-p-a-r-k-s: "fxp" appears in order but never contiguously.
    expect(searchPals(FIXTURE, 'fxp')).toEqual([i.foxparks])
  })

  it('matches a digits-only query against dex, including the variant suffix', () => {
    expect(searchPals(FIXTURE, '48')).toEqual([i.relaxaurus, i.relaxaurusLux])
  })

  it('does not let a digits query match a dex that merely starts with it', () => {
    // Nothing in the fixture has dex "480..." or similar, but guard the rule directly:
    // "1" must not match dex "14" (Foxparks) since the remainder "4" isn't a variant letter.
    expect(searchPals(FIXTURE, '1')).not.toContain(i.foxparks)
  })

  it('applies the type filter before ranking', () => {
    expect(searchPals(FIXTURE, 'b')).toEqual([i.blazamut, i.lamball, i.grizzbolt])
    expect(searchPals(FIXTURE, 'b', ['fire'])).toEqual([i.blazamut])
  })

  it('caps results at 12, ordered by ascending dex', () => {
    const results = searchPals(FIXTURE, 'test')
    expect(results).toHaveLength(12)
    expect(results).toEqual(Array.from({ length: 12 }, (_, k) => 7 + k))
  })
})
