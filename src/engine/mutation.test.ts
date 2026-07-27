import { beforeAll, describe, expect, it } from 'vitest'
import { loadDatasetFromDisk } from './dataset.ts'
import { mutationPool, reverseMutation } from './mutation.ts'
import type { Dataset } from './types.ts'

let ds: Dataset

/** mulberry32, so the sampled pairs are the same on every run. */
function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function samplePairs(count: number): Array<[number, number]> {
  const rand = seeded(20260726)
  const n = ds.pals.length
  return Array.from({ length: count }, () => {
    const a = Math.floor(rand() * n)
    const b = Math.floor(rand() * n)
    return [Math.min(a, b), Math.max(a, b)] as [number, number]
  })
}

function strongest(): number {
  return ds.pals.reduce((best, p, i) => (p.power < ds.pals[best].power ? i : best), 0)
}

beforeAll(async () => {
  ds = await loadDatasetFromDisk('public/data')
})

describe('mutationPool', () => {
  it('returns a non-empty distribution that sums to one', () => {
    const pairs = samplePairs(50)
    expect(pairs).toHaveLength(50)
    for (const [a, b] of pairs) {
      const pool = mutationPool(ds, a, b)
      expect(pool.length).toBeGreaterThan(0)
      const total = pool.reduce((s, o) => s + o.weight, 0)
      expect(Math.abs(total - 1)).toBeLessThan(1e-9)
      expect(new Set(pool.map((o) => o.child)).size).toBe(pool.length)
    }
  })

  it('orders outcomes by descending weight', () => {
    for (const [a, b] of samplePairs(50)) {
      const weights = mutationPool(ds, a, b).map((o) => o.weight)
      expect([...weights].sort((x, y) => y - x)).toEqual(weights)
    }
  })

  it('climbs to stronger pals when both parents share a rank', () => {
    const floor = strongest()
    expect(ds.pals.length).toBeGreaterThan(0)
    for (let i = 0; i < ds.pals.length; i++) {
      if (i === floor) continue
      const pool = mutationPool(ds, i, i)
      expect(pool.length).toBeGreaterThan(0)
      for (const o of pool) expect(ds.pals[o.child].power).toBeLessThan(ds.pals[i].power)
    }
  })

  it('leaves the strongest pal pointing at itself, since there is nothing above it', () => {
    const floor = strongest()
    expect(mutationPool(ds, floor, floor)).toEqual([{ child: floor, weight: 1 }])
  })

  it('is deterministic and order-independent in its parents', () => {
    for (const [a, b] of samplePairs(50)) {
      expect(mutationPool(ds, a, b)).toEqual(mutationPool(ds, a, b))
      expect(mutationPool(ds, b, a)).toEqual(mutationPool(ds, a, b))
    }
  })
})

describe('reverseMutation', () => {
  it('contains every sampled pair that can mutate into the child', () => {
    const pairs = samplePairs(50)
    expect(pairs).toHaveLength(50)
    for (const [a, b] of pairs) {
      const children = new Set(mutationPool(ds, a, b).map((o) => o.child))
      for (const child of children) {
        expect(reverseMutation(ds, child)).toContainEqual({ a, b })
      }
      const outside = ds.pals.findIndex((_, i) => !children.has(i))
      expect(outside).toBeGreaterThanOrEqual(0)
      expect(reverseMutation(ds, outside)).not.toContainEqual({ a, b })
    }
  })

  it('agrees with mutationPool over every pal and every pair', () => {
    const n = ds.pals.length
    const index = new Map<number, Set<number>>()
    for (let a = 0; a < n; a++) {
      for (let b = a; b < n; b++) {
        for (const o of mutationPool(ds, a, b)) {
          let pairs = index.get(o.child)
          if (pairs === undefined) index.set(o.child, (pairs = new Set()))
          pairs.add(a * n + b)
        }
      }
    }
    expect(index.size).toBeGreaterThan(0)

    const mismatches: string[] = []
    for (let target = 0; target < n; target++) {
      const expected = index.get(target) ?? new Set<number>()
      const pairs = reverseMutation(ds, target)
      const actual = new Set(pairs.map((p) => p.a * n + p.b))
      if (pairs.some((p) => p.b < p.a)) mismatches.push(`${ds.pals[target].id}: unordered pair`)
      if (pairs.length !== actual.size) mismatches.push(`${ds.pals[target].id}: duplicate pairs`)
      if (actual.size !== expected.size || [...expected].some((k) => !actual.has(k))) {
        mismatches.push(`${ds.pals[target].id}: ${actual.size} pairs, expected ${expected.size}`)
      }
    }
    expect(mismatches).toEqual([])
  })
})
