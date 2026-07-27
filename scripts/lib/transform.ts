import type { RawUnique } from './palpedia-extract.ts'

export const MATRIX_UNSET = 0xfffe
export const GENDER_SENTINEL = 0xffff
export const GOLDEN_SEED = 0x9e3779b9
export const GOLDEN_PAIR_COUNT = 500
export const GOLDEN_SAME_SPECIES_COUNT = 20

export interface PalcalcPal {
  Id: { PalDexNo: number; IsVariant: boolean }
  Name: string
  InternalName: string
  BreedingPower: number
  BreedingPowerPriority: number
  GuaranteedPassivesInternalIds: string[]
}

export interface PalcalcPassive {
  Name: string
  InternalName: string
  Rank: number
  RandomInheritanceAllowed: boolean
  RandomInheritanceWeight: number
  IsStandardPassiveSkill: boolean
}

export interface PalcalcDb {
  Pals: PalcalcPal[]
  PassiveSkills: PalcalcPassive[]
  BreedingGenderProbability: Record<string, { MALE: number; FEMALE: number }>
}

export interface BreedingEntry {
  Parent1InternalName: string
  Parent1Gender: string
  Parent2InternalName: string
  Parent2Gender: string
  ChildInternalName: string
}

export interface BreedingFile {
  Breeding: BreedingEntry[]
}

export interface PalRecord {
  id: string
  name: string
  dex: string
  types: string[]
  power: number
  priority: number
  maleProb: number
  guaranteed: string[]
  sprite: string
}

export interface UniqueCombo {
  a: number
  b: number
  child: number
}

export type GenderCode = 'F' | 'M'

export interface GenderLockedCombo {
  a: number
  aGender: GenderCode
  b: number
  bGender: GenderCode
  child: number
}

export interface CombosFile {
  unique: UniqueCombo[]
  genderLocked: GenderLockedCombo[]
  sameSpeciesOnly: number[]
}

export interface PassiveRecord {
  id: string
  name: string
  rank: number
  randomAllowed: boolean
  randomWeight: number
  standard: boolean
}

export interface MutationConfig {
  source: string
  rankCoefficient: number
  rankDiffPenalty: number
  randomCoefficient: number
  chances: { base: number; vegetableCake: number; extravagantCake: number }
}

export interface GoldenPair {
  a: string
  b: string
  child: string
}

export interface GoldenGenderLocked {
  a: string
  aGender: GenderCode
  b: string
  bGender: GenderCode
  child: string
}

export interface Goldens {
  pairs: GoldenPair[]
  uniques: GoldenPair[]
  genderLocked: GoldenGenderLocked[]
  sameSpecies: Array<{ a: string; child: string }>
}

export function byInternalName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function indexById(pals: PalRecord[]): Map<string, number> {
  return new Map(pals.map((p, i) => [p.id, i]))
}

export function buildPals(db: PalcalcDb, types: Record<string, string[]>): PalRecord[] {
  return [...db.Pals]
    .sort((a, b) => byInternalName(a.InternalName, b.InternalName))
    .map((p) => ({
      id: p.InternalName,
      name: p.Name,
      dex: `${p.Id.PalDexNo}${p.Id.IsVariant ? 'B' : ''}`,
      types: types[p.InternalName.toLowerCase()] ?? [],
      power: p.BreedingPower,
      priority: p.BreedingPowerPriority,
      maleProb: db.BreedingGenderProbability[p.InternalName]?.MALE ?? 0.5,
      guaranteed: [...p.GuaranteedPassivesInternalIds],
      sprite: `/sprites/${p.InternalName}.webp`,
    }))
}

function genderCode(gender: string): GenderCode {
  if (gender === 'FEMALE') return 'F'
  if (gender === 'MALE') return 'M'
  throw new Error(`unexpected gender value: ${gender}`)
}

export interface MatrixResult {
  matrix: Uint16Array
  genderLocked: GenderLockedCombo[]
  unsetCells: number
}

export function buildMatrix(pals: PalRecord[], entries: BreedingEntry[]): MatrixResult {
  const n = pals.length
  const byId = indexById(pals)
  const matrix = new Uint16Array(n * n).fill(MATRIX_UNSET)

  const resolve = (name: string): number => {
    const i = byId.get(name)
    if (i === undefined) throw new Error(`breeding.json references unknown pal: ${name}`)
    return i
  }

  const genderLocked: GenderLockedCombo[] = []
  for (const e of entries) {
    const a = resolve(e.Parent1InternalName)
    const b = resolve(e.Parent2InternalName)
    const child = resolve(e.ChildInternalName)
    if (e.Parent1Gender === 'WILDCARD' && e.Parent2Gender === 'WILDCARD') {
      matrix[a * n + b] = child
      matrix[b * n + a] = child
    } else {
      genderLocked.push({
        a,
        aGender: genderCode(e.Parent1Gender),
        b,
        bGender: genderCode(e.Parent2Gender),
        child,
      })
    }
  }

  // Gender-locked pairs have no single child, so their cells carry a sentinel the engine branches on.
  for (const g of genderLocked) {
    matrix[g.a * n + g.b] = GENDER_SENTINEL
    matrix[g.b * n + g.a] = GENDER_SENTINEL
  }
  genderLocked.sort((x, y) => (x.aGender === y.aGender ? 0 : x.aGender === 'F' ? -1 : 1))

  let unsetCells = 0
  for (let i = 0; i < matrix.length; i++) if (matrix[i] === MATRIX_UNSET) unsetCells++

  return { matrix, genderLocked, unsetCells }
}

export function computeSameSpeciesOnly(
  pals: PalRecord[],
  matrix: Uint16Array,
  genderLocked: GenderLockedCombo[],
): number[] {
  const n = pals.length
  const producers = new Int32Array(n)
  const selfProducers = new Int32Array(n)
  for (let a = 0; a < n; a++) {
    for (let b = a; b < n; b++) {
      const child = matrix[a * n + b]!
      if (child === GENDER_SENTINEL || child === MATRIX_UNSET) continue
      producers[child]!++
      if (a === b && a === child) selfProducers[child]!++
    }
  }
  // Gender-locked pairs live outside the matrix but are still parent combos for their child.
  for (const g of genderLocked) producers[g.child]!++
  const out: number[] = []
  for (let i = 0; i < n; i++) if (producers[i] === 1 && selfProducers[i] === 1) out.push(i)
  return out
}

export interface MappedUniques {
  unique: UniqueCombo[]
  dropped: RawUnique[]
}

export function mapUniques(pals: PalRecord[], raw: RawUnique[]): MappedUniques {
  const byLowerId = new Map(pals.map((p, i) => [p.id.toLowerCase(), i]))
  const unique: UniqueCombo[] = []
  const dropped: RawUnique[] = []
  for (const u of raw) {
    const a = byLowerId.get(u.parentA.toLowerCase())
    const b = byLowerId.get(u.parentB.toLowerCase())
    const child = byLowerId.get(u.childId.toLowerCase())
    if (a === undefined || b === undefined || child === undefined) {
      dropped.push(u)
      continue
    }
    unique.push({ a, b, child })
  }
  unique.sort((x, y) => x.a - y.a || x.b - y.b || x.child - y.child)
  return { unique, dropped }
}

export function buildCombos(
  pals: PalRecord[],
  matrix: Uint16Array,
  rawUniques: RawUnique[],
  genderLocked: GenderLockedCombo[],
): { combos: CombosFile; dropped: RawUnique[] } {
  const { unique, dropped } = mapUniques(pals, rawUniques)
  return {
    combos: { unique, genderLocked, sameSpeciesOnly: computeSameSpeciesOnly(pals, matrix, genderLocked) },
    dropped,
  }
}

export function buildPassives(db: PalcalcDb): PassiveRecord[] {
  return db.PassiveSkills.filter((p) => !p.InternalName.startsWith('Test'))
    .map((p) => ({
      id: p.InternalName,
      name: p.Name,
      rank: p.Rank,
      randomAllowed: p.RandomInheritanceAllowed,
      randomWeight: p.RandomInheritanceWeight,
      standard: p.IsStandardPassiveSkill,
    }))
    .sort((a, b) => byInternalName(a.id, b.id))
}

export function buildMutation(): MutationConfig {
  return {
    source: 'community-estimated (palpedia.net Discord research)',
    rankCoefficient: 0.5,
    rankDiffPenalty: 0.4,
    randomCoefficient: 0.1,
    chances: { base: 0.01, vegetableCake: 0.02, extravagantCake: 0.03 },
  }
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function sampleIndices(rng: () => number, poolSize: number, count: number): number[] {
  const take = Math.min(count, poolSize)
  const seen = new Set<number>()
  const out: number[] = []
  // Bounded so a degenerate rng can never spin forever.
  for (let guard = 0; out.length < take && guard < take * 1000; guard++) {
    const i = Math.floor(rng() * poolSize)
    if (seen.has(i)) continue
    seen.add(i)
    out.push(i)
  }
  return out
}

export function buildGoldens(
  pals: PalRecord[],
  entries: BreedingEntry[],
  combos: CombosFile,
  matrix: Uint16Array,
): Goldens {
  const n = pals.length
  const id = (i: number): string => pals[i]!.id
  const rng = mulberry32(GOLDEN_SEED)

  const wildcards = entries.filter((e) => e.Parent1Gender === 'WILDCARD' && e.Parent2Gender === 'WILDCARD')
  const pairs = sampleIndices(rng, wildcards.length, GOLDEN_PAIR_COUNT).map((i) => {
    const e = wildcards[i]!
    return { a: e.Parent1InternalName, b: e.Parent2InternalName, child: e.ChildInternalName }
  })

  const uniques = combos.unique.map((u) => ({ a: id(u.a), b: id(u.b), child: id(u.child) }))

  const genderLocked = combos.genderLocked.map((g) => ({
    a: id(g.a),
    aGender: g.aGender,
    b: id(g.b),
    bGender: g.bGender,
    child: id(g.child),
  }))

  let pool = combos.sameSpeciesOnly
  if (pool.length < GOLDEN_SAME_SPECIES_COUNT) {
    pool = []
    for (let i = 0; i < n; i++) if (matrix[i * n + i] === i) pool.push(i)
  }
  const sameSpecies = sampleIndices(rng, pool.length, GOLDEN_SAME_SPECIES_COUNT).map((i) => {
    const p = pool[i]!
    return { a: id(p), child: id(matrix[p * n + p]!) }
  })

  return { pairs, uniques, genderLocked, sameSpecies }
}

/** Explicit little-endian serialisation so the artifact never depends on host byte order. */
export function matrixToBuffer(matrix: Uint16Array): Uint8Array {
  const out = new Uint8Array(matrix.length * 2)
  for (let i = 0; i < matrix.length; i++) {
    const v = matrix[i]!
    out[i * 2] = v & 0xff
    out[i * 2 + 1] = (v >>> 8) & 0xff
  }
  return out
}
