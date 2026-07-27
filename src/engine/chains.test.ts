import { beforeAll, describe, expect, it } from 'vitest'
import { breed } from './breed.ts'
import { findChains } from './chains.ts'
import { loadDatasetFromDisk } from './dataset.ts'
import { GENDER_SENTINEL } from './types.ts'
import type { ChainStep, Dataset } from './types.ts'

let ds: Dataset

function idx(id: string): number {
  const i = ds.byId.get(id)
  if (i === undefined) throw new Error(`unknown pal: ${id}`)
  return i
}

/** Every step of every chain must be a pairing the breeding engine actually produces. */
function expectBreedable(steps: ChainStep[]): void {
  for (const s of steps) {
    expect(breed(ds, s.a, s.b).map((r) => r.child)).toContain(s.child)
  }
}

/** Each step may only pair pals already owned or bred by one of the steps before it. */
function expectOwnedInOrder(steps: ChainStep[], starters: number[]): void {
  const owned = new Set(starters)
  for (const s of steps) {
    expect(owned.has(s.a)).toBe(true)
    expect(owned.has(s.b)).toBe(true)
    owned.add(s.child)
  }
}

/** Two starters whose child breeds back with a starter into a third pal they cannot reach directly. */
function twoStepCase(): { a: number; b: number; target: number } {
  const n = ds.pals.length
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const mid = ds.matrix[a * n + b]
      if (mid === GENDER_SENTINEL) continue
      const target = ds.matrix[mid * n + a]
      if (target === GENDER_SENTINEL || target === a || target === b || target === mid) continue
      if (ds.matrix[a * n + a] === target || ds.matrix[b * n + b] === target) continue
      return { a, b, target }
    }
  }
  throw new Error('dataset has no two-step chain case')
}

/** The first partner, by index, that breeds `lineage` into something other than itself. */
function oneFreePartnerStep(lineage: number): { partner: number; child: number } {
  const n = ds.pals.length
  for (let partner = 0; partner < n; partner++) {
    const child = ds.matrix[lineage * n + partner]
    if (child === GENDER_SENTINEL || child === lineage) continue
    return { partner, child }
  }
  throw new Error(`${ds.pals[lineage].id} breeds into nothing new`)
}

beforeAll(async () => {
  ds = await loadDatasetFromDisk('public/data')
})

describe('findChains with several starters', () => {
  it('takes the one breed that already joins two starters', () => {
    const a = idx('LazyDragon')
    const b = idx('ElecCat')
    const steps = findChains(ds, [a, b], idx('LazyDragon_Electric'))
    expect(steps).toEqual([{ a: Math.min(a, b), b: Math.max(a, b), child: idx('LazyDragon_Electric') }])
    expectBreedable(steps!)
  })

  it('returns an empty chain when the target is already owned', () => {
    const target = idx('LazyDragon')
    expect(findChains(ds, [target, idx('ElecCat')], target)).toEqual([])
  })

  it('reaches both gender-locked children, whichever starter is named first', () => {
    const cat = idx('CatMage')
    const fox = idx('FoxMage')
    expect(findChains(ds, [cat, fox], idx('CatMage_Fire'), 8)).toEqual([{ a: cat, b: fox, child: idx('CatMage_Fire') }])
    expect(findChains(ds, [fox, cat], idx('FoxMage_Dark'), 8)).toEqual([{ a: cat, b: fox, child: idx('FoxMage_Dark') }])
    expectBreedable(findChains(ds, [cat, fox], idx('CatMage_Fire'), 8)!)
  })

  it('keeps breeding past a round that added nothing new', () => {
    // Xenolord + Lyleen Noct reach Renjishi only through pals bred two rounds earlier, so a solver
    // that stops at the first quiet round reports no chain at all.
    const steps = findChains(ds, [idx('DarkMechaDragon'), idx('LilyQueen_Dark')], idx('KabukiMan'), 6)
    expect(steps).not.toBeNull()
    expect(steps!.length).toBeLessThanOrEqual(6)
    expect(steps![steps!.length - 1].child).toBe(idx('KabukiMan'))
    expectBreedable(steps!)
    expectOwnedInOrder(steps!, [idx('DarkMechaDragon'), idx('LilyQueen_Dark')])
  })

  it('ignores duplicate starters', () => {
    const a = idx('LazyDragon')
    const b = idx('ElecCat')
    const steps = findChains(ds, [a, b, a, b], idx('LazyDragon_Electric'))
    expect(steps).toEqual(findChains(ds, [a, b], idx('LazyDragon_Electric')))
    expectBreedable(steps!)
  })

  it('needs a second breed for a pal one step past the starters', () => {
    const { a, b, target } = twoStepCase()
    expect(findChains(ds, [a, b], target, 1)).toBeNull()

    const steps = findChains(ds, [a, b], target, 2)
    expect(steps).not.toBeNull()
    expect(steps!.length).toBeGreaterThan(1)
    expect(steps!.length).toBeLessThanOrEqual(2)
    expect(steps![steps!.length - 1].child).toBe(target)
    expectBreedable(steps!)
  })

  it('emits every step after the steps it depends on', () => {
    const { a, b, target } = twoStepCase()
    expectOwnedInOrder(findChains(ds, [a, b], target, 2)!, [a, b])
  })
})

describe('findChains with one starter', () => {
  it('returns an empty chain when the target is the starter', () => {
    const target = idx('LazyDragon')
    expect(findChains(ds, [target], target)).toEqual([])
  })

  it('breeds the starter with the lowest-index partner that reaches the target', () => {
    const lamball = idx('SheepBall')
    const { partner, child } = oneFreePartnerStep(lamball)
    const steps = findChains(ds, [lamball], child, 1)
    expect(steps).toEqual([{ a: lamball, b: partner, child }])
    expectBreedable(steps!)
  })

  it('keeps every step on the same lineage', () => {
    const lamball = idx('SheepBall')
    const steps = findChains(ds, [lamball], idx('LazyDragon_Electric'), 6)
    expect(steps).not.toBeNull()
    expect(steps!.length).toBeGreaterThan(0)
    expectBreedable(steps!)
    let lineage = lamball
    for (const s of steps!) {
      expect(s.a).toBe(lineage)
      lineage = s.child
    }
    expect(lineage).toBe(idx('LazyDragon_Electric'))
  })

  it('reaches the gender-locked children through their gender-locked route', () => {
    const steps = findChains(ds, [idx('CatMage')], idx('CatMage_Fire'), 1)
    expect(steps).toEqual([{ a: idx('CatMage'), b: idx('FoxMage'), child: idx('CatMage_Fire') }])
    expectBreedable(steps!)
  })

  it('returns null when no breed is allowed at all', () => {
    expect(findChains(ds, [idx('SheepBall')], idx('LazyDragon_Electric'), 0)).toBeNull()
  })
})

/** mulberry32, so the sampled starters and targets are the same on every run. */
function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 50 seeded (starters, target) problems, half of them single-starter. */
function sampleProblems(): Array<{ starters: number[]; target: number }> {
  const rand = seeded(20260727)
  const n = ds.pals.length
  return Array.from({ length: 50 }, (_, i) => {
    const a = Math.floor(rand() * n)
    const b = Math.floor(rand() * n)
    const target = Math.floor(rand() * n)
    return { starters: i % 2 === 0 && a !== b ? [a, b] : [a], target }
  })
}

describe('findChains over sampled problems', () => {
  it('never spends more breeds than the depth allows', () => {
    const problems = sampleProblems()
    expect(problems).toHaveLength(50)
    for (const { starters, target } of problems) {
      for (let depth = 0; depth <= 7; depth++) {
        const steps = findChains(ds, starters, target, depth)
        if (steps === null) continue
        expect(steps.length).toBeLessThanOrEqual(depth)
        expectBreedable(steps)
        if (starters.length > 1) expectOwnedInOrder(steps, starters)
        if (steps.length > 0) expect(steps[steps.length - 1].child).toBe(target)
      }
    }
  })

  it('keeps a chain found at one depth findable at the next', () => {
    const problems = sampleProblems()
    expect(problems).toHaveLength(50)
    const lost: string[] = []
    for (const { starters, target } of problems) {
      for (let depth = 0; depth <= 7; depth++) {
        if (findChains(ds, starters, target, depth) === null) continue
        if (findChains(ds, starters, target, depth + 1) === null) {
          lost.push(`${starters.join('+')} -> ${ds.pals[target].id} at depth ${depth}`)
        }
      }
    }
    expect(lost).toEqual([])
  })
})
