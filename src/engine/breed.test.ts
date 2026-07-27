import { beforeAll, describe, expect, it } from 'vitest'
import { allCombosFor, badgesFor, breed, findParents } from './breed.ts'
import { loadDataset, loadDatasetFromDisk } from './dataset.ts'
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

/** One pal, so the 1x1 matrix is two bytes. Enough to exercise the loader without the real artifacts. */
const STUB_PALS = {
  version: { palcalcCommit: 'a'.repeat(40), gameVersion: '1.0', refreshedAt: '2026-01-01T00:00:00.000Z' },
  pals: [
    {
      id: 'Solo',
      name: 'Solo',
      dex: '1',
      types: ['normal'],
      power: 1,
      priority: 1,
      maleProb: 0.5,
      guaranteed: [],
      sprite: '/sprites/Solo.webp',
    },
  ],
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
}

/** Serves valid stub artifacts, so a test only has to describe the one file it wants to break. */
function stubFetch(overrides: Record<string, () => Promise<Response>> = {}): typeof fetch {
  const defaults: Record<string, () => Response> = {
    'pals.json': () => jsonResponse(STUB_PALS),
    'matrix.bin': () => new Response(new Uint8Array([0, 0])),
    'combos.json': () => jsonResponse({ unique: [], genderLocked: [], sameSpeciesOnly: [] }),
    'passives.json': () => jsonResponse([]),
    'mutation.json': () => jsonResponse(ds.mutation),
  }
  return async (input) => {
    const url = String(input)
    const file = url.slice(url.lastIndexOf('/') + 1)
    const override = overrides[file]
    if (override !== undefined) return override()
    const fallback = defaults[file]
    if (fallback === undefined) throw new Error(`unexpected fetch: ${url}`)
    return fallback()
  }
}

describe('loadDataset', () => {
  it('requests every artifact under baseUrl and assembles them', async () => {
    const seen: string[] = []
    const loaded = await loadDataset('/palmatch', async (input) => {
      seen.push(String(input))
      return stubFetch()(input)
    })
    expect(seen.sort()).toEqual([
      '/palmatch/data/combos.json',
      '/palmatch/data/matrix.bin',
      '/palmatch/data/mutation.json',
      '/palmatch/data/pals.json',
      '/palmatch/data/passives.json',
    ])
    expect(loaded.pals).toHaveLength(1)
    expect(loaded.byId.get('Solo')).toBe(0)
    expect(loaded.matrix).toHaveLength(1)
  })

  it('wraps a network throw with the failing URL', async () => {
    const fetchFn = stubFetch({ 'combos.json': () => Promise.reject(new TypeError('Failed to fetch')) })
    await expect(loadDataset('', fetchFn)).rejects.toThrow('failed to fetch /data/combos.json')
  })

  it('reports the status on a non-ok response', async () => {
    const fetchFn = stubFetch({
      'pals.json': async () => new Response('', { status: 404, statusText: 'Not Found' }),
    })
    await expect(loadDataset('', fetchFn)).rejects.toThrow('failed to fetch /data/pals.json: 404 Not Found')
  })

  it('rejects a matrix whose byte length is not a whole number of cells', async () => {
    const fetchFn = stubFetch({ 'matrix.bin': async () => new Response(new Uint8Array([0, 0, 0])) })
    await expect(loadDataset('', fetchFn)).rejects.toThrow(
      'failed to read /data/matrix.bin: 3 bytes is not a whole number of Uint16 cells',
    )
  })

  it('names the file that failed to parse as JSON', async () => {
    const fetchFn = stubFetch({ 'passives.json': async () => new Response('{not json') })
    await expect(loadDataset('', fetchFn)).rejects.toThrow('failed to parse /data/passives.json as JSON')
  })

  it('rejects a matrix that does not match the pal count', async () => {
    const fetchFn = stubFetch({ 'matrix.bin': async () => new Response(new Uint8Array([0, 0, 0, 0])) })
    await expect(loadDataset('', fetchFn)).rejects.toThrow('matrix holds 2 cells, expected 1 for 1 pals')
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
      expect(forward[0].child).toBe(idx(g.child))
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
      {
        child: idx('CatMage_Fire'),
        condition: 'gender-AF',
        lock: { aId: 'CatMage', aGender: 'F', bId: 'FoxMage', bGender: 'M' },
      },
      {
        child: idx('FoxMage_Dark'),
        condition: 'gender-AM',
        lock: { aId: 'CatMage', aGender: 'M', bId: 'FoxMage', bGender: 'F' },
      },
    ]
    expect(breed(ds, idx('CatMage'), idx('FoxMage'))).toEqual(expected)
    expect(breed(ds, idx('FoxMage'), idx('CatMage'))).toEqual(expected)
  })

  it('omits lock on every non-gender-locked result', () => {
    const pairs: Array<[number, number]> = [
      [idx('Alpaca'), idx('ElecCat')],
      [idx('Alpaca'), idx('Alpaca')],
      [idx('LazyDragon'), idx('ElecCat')],
    ]
    for (const [a, b] of pairs) {
      expect(breed(ds, a, b).every((r) => r.lock === undefined)).toBe(true)
    }
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
    expect(ds.combos.sameSpeciesOnly.length).toBeGreaterThan(0)
    for (const i of ds.combos.sameSpeciesOnly) {
      const combos = findParents(ds, i)
      expect(combos).toHaveLength(1)
      expect(combos[0].a).toBe(i)
      expect(combos[0].b).toBe(i)
      expect(combos[0].badges).toContain('same-species')
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
    expect(all[a].results).toEqual([{ child: a, condition: 'same-species' }])
    expect(all[idx('ElecCat')].results).toEqual(breed(ds, a, idx('ElecCat')))
  })

  it('carries both gender-locked outcomes through as one partner entry', () => {
    expect(allCombosFor(ds, idx('CatMage'))[idx('FoxMage')].results).toHaveLength(2)
  })
})
