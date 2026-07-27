import { allCombosFor, findParents } from '../../engine/breed.ts'
import { reverseMutation } from '../../engine/mutation.ts'
import type { ComboBadge, Dataset, GenderLock } from '../../engine/types.ts'

/**
 * One line of a `ComboTable`: an unordered parent pair, the child when it varies per row, and the
 * badges the pair earns. `lockHint` spells the gender requirement out for the gender-locked pill,
 * which otherwise can only say *that* genders matter and not which.
 */
export interface ComboRow {
  a: number
  b: number
  /** Omitted where every row makes the same child (parent-combos, via-mutation). */
  child?: number
  badges: ComboBadge[]
  lockHint?: string
}

export function rowKey(row: ComboRow): string {
  return `${row.a}-${row.b}-${row.child ?? ''}`
}

function hintFor(ds: Dataset, lock: GenderLock): string {
  const name = (id: string): string => {
    const index = ds.byId.get(id)
    return index === undefined ? id : ds.pals[index].name
  }
  const glyph = (g: 'F' | 'M'): string => (g === 'F' ? '♀' : '♂')
  return `${glyph(lock.aGender)} ${name(lock.aId)} × ${glyph(lock.bGender)} ${name(lock.bId)}`
}

/** Every partner for `a` and what the pair makes — the gender-locked partner contributes two rows. */
export function comboRowsFor(ds: Dataset, a: number): ComboRow[] {
  const rows: ComboRow[] = []
  for (const entry of allCombosFor(ds, a)) {
    for (const result of entry.results) {
      const badges: ComboBadge[] =
        result.condition === 'unique'
          ? ['unique']
          : result.condition === 'same-species'
            ? ['same-species']
            : result.condition === 'standard'
              ? []
              : ['gender-locked']
      rows.push({
        a,
        b: entry.partner,
        child: result.child,
        badges,
        lockHint: result.lock === undefined ? undefined : hintFor(ds, result.lock),
      })
    }
  }
  return rows
}

/** Every pair that breeds `target` directly. The child is the target, so rows carry none. */
export function parentRowsFor(ds: Dataset, target: number): ComboRow[] {
  return findParents(ds, target).map((combo) => {
    if (!combo.badges.includes('gender-locked')) return { ...combo }
    // `findParents` badges gender-locked routes without saying which parent must be which; the
    // combos table still holds that, keyed by the child the orientation produces.
    const locked = ds.combos.genderLocked.find(
      (g) => g.child === target && Math.min(g.a, g.b) === combo.a && Math.max(g.a, g.b) === combo.b,
    )
    const lockHint =
      locked === undefined
        ? undefined
        : hintFor(ds, {
            aId: ds.pals[locked.a].id,
            aGender: locked.aGender,
            bId: ds.pals[locked.b].id,
            bGender: locked.bGender,
          })
    return { ...combo, lockHint }
  })
}

/** Every pair whose mutation window can roll `target`. Thousands of rows for common ranks. */
export function mutationRowsFor(ds: Dataset, target: number): ComboRow[] {
  return reverseMutation(ds, target).map((pair) => ({ a: pair.a, b: pair.b, badges: [] }))
}
