import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  GENDER_SENTINEL,
  GOLDEN_PAIR_COUNT,
  GOLDEN_SAME_SPECIES_COUNT,
  MATRIX_UNSET,
  buildCombos,
  buildGoldens,
  buildMatrix,
  buildPals,
  indexById,
  mulberry32,
  type BreedingFile,
  type PalcalcDb,
} from './transform.ts'

const DB = '.cache/db.json'
const BREEDING = '.cache/breeding.json'
const TYPES = 'data/palpedia-types.json'
const UNIQUES = 'data/palpedia-uniques.json'
const hasCache = existsSync(DB) && existsSync(BREEDING) && existsSync(TYPES) && existsSync(UNIQUES)

describe.skipIf(!hasCache)('transform against cached palcalc data', () => {
  const db = JSON.parse(readFileSync(DB, 'utf8')) as PalcalcDb
  const breeding = JSON.parse(readFileSync(BREEDING, 'utf8')) as BreedingFile
  const types = JSON.parse(readFileSync(TYPES, 'utf8')) as Record<string, string[]>
  const uniques = JSON.parse(readFileSync(UNIQUES, 'utf8')) as Array<{
    parentA: string
    parentB: string
    childId: string
  }>

  const pals = buildPals(db, types)
  const n = pals.length
  const byId = indexById(pals)
  const { matrix, genderLocked } = buildMatrix(pals, breeding.Breeding)
  const { combos } = buildCombos(pals, matrix, uniques, genderLocked)
  const goldens = buildGoldens(pals, breeding.Breeding, combos, matrix)

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
