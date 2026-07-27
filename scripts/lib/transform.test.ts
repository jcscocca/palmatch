import { existsSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { GENDER_SENTINEL } from '../../src/engine/types.ts'
import { SYNTHETIC_TYPES, syntheticDb, syntheticEntries } from './__fixtures__/synthetic.ts'
import {
  GOLDEN_PAIR_COUNT,
  GOLDEN_SAME_SPECIES_COUNT,
  MATRIX_UNSET,
  buildCombos,
  buildGoldens,
  buildMatrix,
  buildPals,
  buildPassives,
  computeSameSpeciesOnly,
  indexById,
  mapUniques,
  matrixToBuffer,
  mulberry32,
  type BreedingFile,
  type PalcalcDb,
} from './transform.ts'

describe('transform (synthetic fixtures, no cache required)', () => {
  const db = syntheticDb()
  const pals = buildPals(db, SYNTHETIC_TYPES)
  const entries = syntheticEntries()
  const { matrix, genderLocked } = buildMatrix(pals, entries)

  it('sorts pals by internal name and derives each field', () => {
    expect(pals.map((p) => p.id)).toEqual(['Aaa', 'Bbb', 'Ccc'])
    expect(pals[0]).toEqual({
      id: 'Aaa',
      name: 'Ay',
      dex: '1',
      types: ['fire'],
      power: 100,
      priority: 10000,
      maleProb: 0.3,
      guaranteed: [],
      sprite: '/sprites/Aaa.webp',
    })
    expect(pals[2]!.dex).toBe('2B')
    expect(pals[1]!.dex).toBe('2')
    expect(pals[2]!.maleProb).toBe(0.5)
  })

  it('serialises the matrix little-endian', () => {
    expect([...matrixToBuffer(new Uint16Array([0x0001, MATRIX_UNSET, GENDER_SENTINEL]))]).toEqual([
      0x01, 0x00, 0xfe, 0xff, 0xff, 0xff,
    ])
    expect([...matrixToBuffer(new Uint16Array([0x1234]))]).toEqual([0x34, 0x12])
  })

  it('finds pals whose only producer is themselves', () => {
    expect(computeSameSpeciesOnly(pals, matrix, [])).toEqual([2])
  })

  it('excludes pals reachable through a gender-locked combo', () => {
    const locked = [{ a: 0, aGender: 'F' as const, b: 1, bGender: 'M' as const, child: 2 }]
    expect(computeSameSpeciesOnly(pals, matrix, locked)).toEqual([])
  })

  it('maps uniques case-insensitively and drops unknown pals', () => {
    const { unique, dropped } = mapUniques(pals, [
      { parentA: 'aaa', parentB: 'BBB', childId: 'Ccc' },
      { parentA: 'Aaa', parentB: 'Zzz', childId: 'Ccc' },
      { parentA: 'Aaa', parentB: 'Bbb', childId: 'Nope' },
    ])
    expect(unique).toEqual([{ a: 0, b: 1, child: 2 }])
    expect(dropped).toEqual([
      { parentA: 'Aaa', parentB: 'Zzz', childId: 'Ccc' },
      { parentA: 'Aaa', parentB: 'Bbb', childId: 'Nope' },
    ])
  })

  it('drops Test* passives and sorts the rest by id', () => {
    const passives = buildPassives(db)
    expect(passives.map((p) => p.id)).toEqual(['Runner', 'Swift'])
    expect(passives[1]).toEqual({
      id: 'Swift',
      name: 'Swift',
      rank: 2,
      randomAllowed: true,
      randomWeight: 50,
      standard: true,
    })
  })

  it('rejects an unrecognised gender value', () => {
    const bad = [
      ...entries,
      {
        Parent1InternalName: 'Aaa',
        Parent1Gender: 'NEITHER',
        Parent2InternalName: 'Bbb',
        Parent2Gender: 'MALE',
        ChildInternalName: 'Ccc',
      },
    ]
    expect(() => buildMatrix(pals, bad)).toThrow(/unexpected gender value: NEITHER/)
  })

  it('rejects breeding rows naming an unknown pal', () => {
    expect(() => buildMatrix(pals, [{ ...entries[0]!, ChildInternalName: 'Zzz' }])).toThrow(/unknown pal: Zzz/)
  })

  it('reports no gender-locked pairs when every row is a wildcard', () => {
    expect(genderLocked).toEqual([])
  })
})

const DB = '.cache/db.json'
const BREEDING = '.cache/breeding.json'
const TYPES = 'data/palpedia-types.json'
const UNIQUES = 'data/palpedia-uniques.json'
const hasCache = existsSync(DB) && existsSync(BREEDING) && existsSync(TYPES) && existsSync(UNIQUES)

// `describe.skipIf` still runs the callback body, so the cache reads have to stay behind the guard.
function loadCacheFixture() {
  const db = JSON.parse(readFileSync(DB, 'utf8')) as PalcalcDb
  const breeding = JSON.parse(readFileSync(BREEDING, 'utf8')) as BreedingFile
  const types = JSON.parse(readFileSync(TYPES, 'utf8')) as Record<string, string[]>
  const uniques = JSON.parse(readFileSync(UNIQUES, 'utf8')) as Array<{
    parentA: string
    parentB: string
    childId: string
  }>
  const pals = buildPals(db, types)
  const { matrix, genderLocked } = buildMatrix(pals, breeding.Breeding)
  const { combos } = buildCombos(pals, matrix, uniques, genderLocked)
  return {
    db,
    breeding,
    pals,
    matrix,
    combos,
    goldens: buildGoldens(pals, breeding.Breeding, combos, matrix),
  }
}

describe.skipIf(!hasCache)('transform against cached palcalc data', () => {
  let db: PalcalcDb
  let breeding: BreedingFile
  let pals: ReturnType<typeof buildPals>
  let matrix: Uint16Array
  let combos: ReturnType<typeof buildCombos>['combos']
  let goldens: ReturnType<typeof buildGoldens>
  let n: number
  let byId: Map<string, number>

  beforeAll(() => {
    ;({ db, breeding, pals, matrix, combos, goldens } = loadCacheFixture())
    n = pals.length
    byId = indexById(pals)
  })

  it('is symmetric on 100 sampled pairs', () => {
    const rng = mulberry32(1234)
    for (let i = 0; i < 100; i++) {
      const a = Math.floor(rng() * n)
      const b = Math.floor(rng() * n)
      expect(matrix[a * n + b]).toBe(matrix[b * n + a])
    }
  })

  it('leaves no unfilled cells', () => {
    expect([...matrix].filter((c) => c === MATRIX_UNSET)).toHaveLength(0)
  })

  it('agrees between pals.json order and matrix indices', () => {
    const alpaca = byId.get('Alpaca')
    expect(alpaca).toBeTypeOf('number')
    expect(matrix[alpaca! * n + alpaca!]).toBe(alpaca)

    const lazyDragon = byId.get('LazyDragon')!
    const elecCat = byId.get('ElecCat')!
    expect(pals[matrix[lazyDragon * n + elecCat]!]!.id).toBe('LazyDragon_Electric')
  })

  it('marks the gender-locked cells with the sentinel', () => {
    const catMage = byId.get('CatMage')!
    const foxMage = byId.get('FoxMage')!
    expect(matrix[catMage * n + foxMage]).toBe(GENDER_SENTINEL)
    expect(matrix[foxMage * n + catMage]).toBe(GENDER_SENTINEL)
    expect(combos.genderLocked).toHaveLength(2)
    expect(combos.genderLocked[0]!.aGender).toBe('F')
  })

  it('produces goldens of the contracted shape', () => {
    expect(goldens.pairs).toHaveLength(GOLDEN_PAIR_COUNT)
    expect(goldens.genderLocked.length).toBeGreaterThanOrEqual(2)
    expect(goldens.sameSpecies).toHaveLength(GOLDEN_SAME_SPECIES_COUNT)
    expect(goldens.uniques.length).toBeGreaterThan(0)
    for (const g of goldens.pairs) {
      expect(pals[matrix[byId.get(g.a)! * n + byId.get(g.b)!]!]!.id).toBe(g.child)
    }
    for (const g of goldens.sameSpecies) {
      expect(g.child).toBe(g.a)
    }
  })

  it('is deterministic across runs', () => {
    expect(buildGoldens(pals, breeding.Breeding, combos, matrix)).toEqual(goldens)
  })

  it('formats dex numbers with a B suffix only for variants', () => {
    for (const raw of db.Pals) {
      const record = pals[byId.get(raw.InternalName)!]!
      expect(record.dex).toBe(`${raw.Id.PalDexNo}${raw.Id.IsVariant ? 'B' : ''}`)
    }
    const variants = pals.filter((p) => p.dex.endsWith('B'))
    expect(variants.length).toBeGreaterThan(0)
    expect(pals.filter((p) => !p.dex.endsWith('B')).every((p) => /^\d+$/.test(p.dex))).toBe(true)
  })

  it('gives every pal a type and a sprite path', () => {
    expect(pals.filter((p) => p.types.length === 0)).toHaveLength(0)
    expect(pals.every((p) => p.sprite === `/sprites/${p.id}.webp`)).toBe(true)
  })
})
