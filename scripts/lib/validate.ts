import { TYPE_TO_ELEMENT } from '../../src/lib/elements.ts'
import {
  GENDER_SENTINEL,
  GOLDEN_PAIR_COUNT,
  GOLDEN_SAME_SPECIES_COUNT,
  MATRIX_UNSET,
  indexById,
  type BreedingEntry,
  type CombosFile,
  type Goldens,
  type PalRecord,
} from './transform.ts'

export const EXPECTED_PAL_COUNT = 299
export const EXPECTED_GENDER_LOCKED_COUNT = 2

/** Thrown only for data-gate failures, so the orchestrator can print it without a stack trace. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export interface ValidateInput {
  pals: PalRecord[]
  matrix: Uint16Array
  combos: CombosFile
  goldens: Goldens
  entries: BreedingEntry[]
  /** Sprite source filenames present in the cache, e.g. `Azurobe Cryst.png`. */
  spriteFiles: Set<string>
  /** Element icon filenames present in the cache, e.g. `Dragon.png`. */
  elementFiles: Set<string>
}

export function validate(input: ValidateInput): void {
  const { pals, matrix, combos, goldens, entries, spriteFiles, elementFiles } = input
  const n = pals.length
  const errors: string[] = []
  const byId = indexById(pals)
  const fail = (msg: string): void => {
    errors.push(msg)
  }

  if (n !== EXPECTED_PAL_COUNT) fail(`expected ${EXPECTED_PAL_COUNT} pals, got ${n}`)

  const missingSprites = pals.filter((p) => !spriteFiles.has(`${p.name}.png`)).map((p) => p.name)
  if (missingSprites.length > 0) fail(`missing sprite source for ${missingSprites.length} pal(s): ${missingSprites.join(', ')}`)

  const untyped = pals.filter((p) => p.types.length === 0).map((p) => p.id)
  if (untyped.length > 0) fail(`pals with no types: ${untyped.join(', ')}`)

  const unmappedTypes = [...new Set(pals.flatMap((p) => p.types))].filter((t) => {
    const element = TYPE_TO_ELEMENT[t]
    return element === undefined || !elementFiles.has(`${element}.png`)
  })
  if (unmappedTypes.length > 0) fail(`types with no element icon: ${unmappedTypes.join(', ')}`)

  if (matrix.length !== n * n) fail(`matrix length ${matrix.length}, expected ${n * n}`)

  let unset = 0
  let asymmetric = 0
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      const cell = matrix[a * n + b]!
      if (cell === MATRIX_UNSET) unset++
      if (cell !== matrix[b * n + a]) asymmetric++
    }
  }
  if (unset > 0) fail(`${unset} matrix cell(s) never filled (0xFFFE sentinel remains)`)
  if (asymmetric > 0) fail(`${asymmetric} matrix cell(s) are asymmetric`)

  // Every unique combo the snapshot claims must agree with palcalc's own table.
  for (const u of combos.unique) {
    const cell = matrix[u.a * n + u.b]!
    if (cell !== u.child) {
      fail(
        `unique combo ${pals[u.a]?.id}+${pals[u.b]?.id} claims ${pals[u.child]?.id}, matrix says ` +
          `${cell === GENDER_SENTINEL ? 'gender-locked' : pals[cell]?.id}`,
      )
    }
  }

  const spot = (a: string, b: string, child: string): void => {
    const ai = byId.get(a)
    const bi = byId.get(b)
    const ci = byId.get(child)
    if (ai === undefined || bi === undefined || ci === undefined) {
      fail(`spot-check references unknown pal: ${a}+${b}=${child}`)
      return
    }
    if (matrix[ai * n + bi] !== ci) fail(`spot-check failed: ${a}+${b} should be ${child}`)
    if (!goldens.uniques.some((g) => g.a === a && g.b === b && g.child === child))
      fail(`spot-check ${a}+${b}=${child} missing from goldens.uniques`)
  }
  spot('LazyDragon', 'ElecCat', 'LazyDragon_Electric')

  const lockedEntries = entries.filter((e) => e.Parent1Gender !== 'WILDCARD' || e.Parent2Gender !== 'WILDCARD')
  if (combos.genderLocked.length !== EXPECTED_GENDER_LOCKED_COUNT)
    fail(`combos.genderLocked has ${combos.genderLocked.length} entries, expected ${EXPECTED_GENDER_LOCKED_COUNT}`)
  if (lockedEntries.length !== combos.genderLocked.length)
    fail(`breeding.json has ${lockedEntries.length} gender-locked entries, combos has ${combos.genderLocked.length}`)
  for (const e of lockedEntries) {
    const match = combos.genderLocked.find(
      (g) =>
        pals[g.a]?.id === e.Parent1InternalName &&
        pals[g.b]?.id === e.Parent2InternalName &&
        pals[g.child]?.id === e.ChildInternalName &&
        g.aGender === e.Parent1Gender[0] &&
        g.bGender === e.Parent2Gender[0],
    )
    if (!match)
      fail(
        `gender-locked entry missing from combos: ${e.Parent1InternalName}(${e.Parent1Gender}) x ` +
          `${e.Parent2InternalName}(${e.Parent2Gender}) = ${e.ChildInternalName}`,
      )
    const ai = byId.get(e.Parent1InternalName)
    const bi = byId.get(e.Parent2InternalName)
    if (ai === undefined || bi === undefined) {
      fail(`gender-locked entry references unknown pal: ${e.Parent1InternalName} x ${e.Parent2InternalName}`)
    } else if (matrix[ai * n + bi] !== GENDER_SENTINEL) {
      fail(`gender-locked cell ${e.Parent1InternalName}x${e.Parent2InternalName} is not the 0xFFFF sentinel`)
    }
  }
  if (combos.genderLocked[0]?.aGender !== 'F') fail('combos.genderLocked[0] must be the aGender:"F" direction')

  if (goldens.pairs.length !== GOLDEN_PAIR_COUNT)
    fail(`goldens.pairs has ${goldens.pairs.length} entries, expected ${GOLDEN_PAIR_COUNT}`)
  for (const g of goldens.pairs) {
    const ai = byId.get(g.a)
    const bi = byId.get(g.b)
    if (ai === undefined || bi === undefined || pals[matrix[ai * n + bi]!]?.id !== g.child) {
      fail(`golden pair disagrees with matrix: ${g.a}+${g.b}=${g.child}`)
      break
    }
  }

  if (goldens.sameSpecies.length !== GOLDEN_SAME_SPECIES_COUNT)
    fail(`goldens.sameSpecies has ${goldens.sameSpecies.length} entries, expected ${GOLDEN_SAME_SPECIES_COUNT}`)
  for (const g of goldens.sameSpecies) {
    const i = byId.get(g.a)
    if (i === undefined || matrix[i * n + i] !== i || g.child !== g.a)
      fail(`same-species identity failed for ${g.a}`)
  }

  if (goldens.genderLocked.length !== lockedEntries.length)
    fail(`goldens.genderLocked has ${goldens.genderLocked.length} entries, expected ${lockedEntries.length}`)

  if (errors.length > 0) {
    throw new ValidationError(`data validation failed (${errors.length}):\n  - ${errors.join('\n  - ')}`)
  }
}
