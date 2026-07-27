/**
 * Matrix cell value for the one pair whose child depends on which parent is female. Part of the
 * artifact contract: the pipeline writes it, the engine branches on it.
 */
export const GENDER_SENTINEL = 0xffff

export interface PalRecord {
  /** palcalc InternalName, e.g. `CatMage`. Stable across game versions; the dataset is sorted by it. */
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

export type GenderCode = 'F' | 'M'

export interface UniqueCombo {
  a: number
  b: number
  child: number
}

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

export interface DatasetVersion {
  palcalcCommit: string
  gameVersion: string
  refreshedAt: string
}

export interface PalsFile {
  version: DatasetVersion
  pals: PalRecord[]
}

/** Every index in the engine is a position in `pals`, which `matrix` and `combos` are keyed by. */
export interface Dataset {
  pals: PalRecord[]
  byId: Map<string, number>
  matrix: Uint16Array
  combos: CombosFile
  passives: PassiveRecord[]
  mutation: MutationConfig
  version: DatasetVersion
}

/** `gender-AF`/`gender-AM` name the gender required of the *stored* A-side parent, not the caller's. */
export type BreedCondition = 'standard' | 'unique' | 'same-species' | 'gender-AF' | 'gender-AM'

/** Which parent must be which gender. Carries ids so the UI never re-derives the stored orientation. */
export interface GenderLock {
  aId: string
  aGender: GenderCode
  bId: string
  bGender: GenderCode
}

export interface BreedResult {
  child: number
  condition: BreedCondition
  /** Present exactly when `condition` is `gender-AF` or `gender-AM`. */
  lock?: GenderLock
}

export interface ComboEntry {
  partner: number
  results: BreedResult[]
}

/** One breed in a chain: `a` x `b` produces `child`. */
export interface ChainStep {
  a: number
  b: number
  child: number
}

/** What the chain worker is asked for. `requestId` comes back on the answer, so a slow reply is discardable. */
export interface ChainRequest {
  requestId: number
  starters: number[]
  target: number
  maxDepth?: number
  /**
   * Absolute base URL for dataset fetches, computed on the main thread. The worker cannot use
   * `import.meta.env.BASE_URL` itself: under `base: './'` that value is relative, and inside a
   * worker it resolves against the worker chunk's own URL (`…/assets/`), 404ing on Pages deploys.
   */
  baseUrl: string
}

export type ChainResponse =
  | { ok: true; requestId: number; steps: ChainStep[] | null }
  | { ok: false; requestId: number; error: string }

/** One possible mutation child and its share of the mutation roll. */
export interface MutationOutcome {
  child: number
  weight: number
}

/** An unordered parent pair, `a <= b`. */
export interface MutationPair {
  a: number
  b: number
}

export type ComboBadge = 'unique' | 'same-species' | 'gender-locked'

export interface ParentCombo {
  a: number
  b: number
  badges: ComboBadge[]
}
