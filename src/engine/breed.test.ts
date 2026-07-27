import { beforeAll, describe, expect, it } from 'vitest'
import { allCombosFor, badgesFor, breed, findParents, genderLockedLabel } from './breed.ts'
import { loadDatasetFromDisk } from './dataset.ts'
import goldens from './fixtures/goldens.json'
import type { Dataset } from './types.ts'

const PAL_COUNT = 299

let ds: Dataset

function idx(id: string): number {
  const i = ds.byId.get(id)
  if (i === undefined) throw new Error(`unknown pal: ${id}`)
  return i
}

beforeAll(async () => {
  ds = await loadDatasetFromDisk('public/data')
})

describe('loadDatasetFromDisk', () => {
  it('assembles the committed artifacts into one dataset', () => {
    expect(ds.pals).toHaveLength(PAL_COUNT)
    expect(ds.byId.size).toBe(PAL_COUNT)
    expect(ds.matrix).toHaveLength(PAL_COUNT * PAL_COUNT)
    expect(ds.combos.genderLocked).toHaveLength(2)
    expect(ds.passives.length).toBeGreaterThan(0)
    expect(ds.mutation.chances.base).toBeGreaterThan(0)
    expect(ds.version.palcalcCommit).toMatch(/^[0-9a-f]{40}$/)
  })

  it('names the file it could not read', async () => {
    await expect(loadDatasetFromDisk('public/nope')).rejects.toThrow(/failed to read public\/nope\//)
  })
})

describe('breed', () => {
  it('labels an ordinary pair standard', () => {
    expect(breed(ds, idx('Alpaca'), idx('ElecCat'))).toEqual([{ child: idx('FlameBambi'), condition: 'standard' }])
  })

  it('reproduces every golden wildcard pair, in both argument orders', () => {
    expect(goldens.pairs).toHaveLength(500)
    for (const g of goldens.pairs) {
      const a = idx(g.a)
      const b = idx(g.b)
      const forward = breed(ds, a, b)
      expect(forward).toHaveLength(1)
      expect(forward[0]!.child).toBe(idx(g.child))
      expect(breed(ds, b, a)).toEqual(forward)
    }
  })

  it('flags every golden unique combo, with same-species winning for self-pairs', () => {
    expect(goldens.uniques).toHaveLength(249)
    for (const g of goldens.uniques) {
      const a = idx(g.a)
      const b = idx(g.b)
      const expected = [{ child: idx(g.child), condition: a === b ? 'same-species' : 'unique' }]
      expect(breed(ds, a, b)).toEqual(expected)
      expect(breed(ds, b, a)).toEqual(expected)
    }
  })

  it('returns both outcomes for the gender-locked pair, in either order', () => {
    const expected = [
      { child: idx('CatMage_Fire'), condition: 'gender-AF' },
      { child: idx('FoxMage_Dark'), condition: 'gender-AM' },
    ]
    expect(breed(ds, idx('CatMage'), idx('FoxMage'))).toEqual(expected)
    expect(breed(ds, idx('FoxMage'), idx('CatMage'))).toEqual(expected)
  })

  it('breeds every golden same-species pal back to itself', () => {
    expect(goldens.sameSpecies).toHaveLength(20)
    for (const g of goldens.sameSpecies) {
      const a = idx(g.a)
      expect(idx(g.child)).toBe(a)
      expect(breed(ds, a, a)).toEqual([{ child: a, condition: 'same-species' }])
    }
  })
})

describe('genderLockedLabel', () => {
  it('names the gendered parents behind each gender-locked outcome', () => {
    const [af, am] = breed(ds, idx('CatMage'), idx('FoxMage'))
    expect(genderLockedLabel(ds, af!)).toEqual({ aId: 'CatMage', aGender: 'F', bId: 'FoxMage', bGender: 'M' })
    expect(genderLockedLabel(ds, am!)).toEqual({ aId: 'CatMage', aGender: 'M', bId: 'FoxMage', bGender: 'F' })
  })

  it('returns undefined for a result that is not gender-locked', () => {
    expect(genderLockedLabel(ds, { child: idx('Alpaca'), condition: 'same-species' })).toBeUndefined()
  })
})

describe('badgesFor', () => {
  it('orders unique before same-species when both apply', () => {
    const selfUnique = ds.combos.unique.find((u) => u.a === u.b)!
    expect(badgesFor(ds, selfUnique.a, selfUnique.b)).toEqual(['unique', 'same-species'])
  })

  it('returns no badges for an ordinary pair', () => {
    expect(badgesFor(ds, idx('Alpaca'), idx('ElecCat'))).toEqual([])
  })
})

describe('findParents', () => {
  it('finds the unique LazyDragon x ElecCat route to LazyDragon_Electric', () => {
    const [a, b] = [idx('LazyDragon'), idx('ElecCat')].sort((x, y) => x - y)
    expect(findParents(ds, idx('LazyDragon_Electric'))).toContainEqual({ a, b, badges: ['unique'] })
  })

  it('returns only the self-pair for every same-species-only pal', () => {
    expect(ds.combos.sameSpeciesOnly).toHaveLength(26)
    for (const i of ds.combos.sameSpeciesOnly) {
      const combos = findParents(ds, i)
      expect(combos).toHaveLength(1)
      expect(combos[0]!.a).toBe(i)
      expect(combos[0]!.b).toBe(i)
      expect(combos[0]!.badges).toContain('same-species')
    }
  })

  it('includes the gender-locked route to CatMage_Fire', () => {
    const [a, b] = [idx('CatMage'), idx('FoxMage')].sort((x, y) => x - y)
    expect(findParents(ds, idx('CatMage_Fire'))).toContainEqual({ a, b, badges: ['gender-locked'] })
  })

  it('reports upper-triangle pairs that really breed to the target', () => {
    // CatMage_Fire covers the gender-locked route, whose matrix cell is the sentinel, not the target.
    for (const target of [idx('Gorilla'), idx('CatMage_Fire')]) {
      const combos = findParents(ds, target)
      expect(combos.length).toBeGreaterThan(0)
      for (const c of combos) {
        expect(c.b).toBeGreaterThanOrEqual(c.a)
        expect(breed(ds, c.a, c.b).map((r) => r.child)).toContain(target)
      }
    }
  })
})

describe('allCombosFor', () => {
  it('covers every partner index and mirrors breed()', () => {
    const a = idx('Alpaca')
    const all = allCombosFor(ds, a)
    expect(all).toHaveLength(PAL_COUNT)
    expect(all.map((c) => c.partner)).toEqual([...Array(PAL_COUNT).keys()])
    expect(all[a]!.result).toEqual([{ child: a, condition: 'same-species' }])
    expect(all[idx('ElecCat')]!.result).toEqual(breed(ds, a, idx('ElecCat')))
  })

  it('carries both gender-locked outcomes through as one partner entry', () => {
    expect(allCombosFor(ds, idx('CatMage'))[idx('FoxMage')]!.result).toHaveLength(2)
  })
})
