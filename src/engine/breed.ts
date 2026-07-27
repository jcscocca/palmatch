import { GENDER_SENTINEL } from './types.ts'
import type { BreedResult, ComboBadge, ComboEntry, Dataset, ParentCombo } from './types.ts'

function isUniquePair(ds: Dataset, a: number, b: number): boolean {
  return ds.combos.unique.some((u) => (u.a === a && u.b === b) || (u.a === b && u.b === a))
}

/**
 * Children of `a` x `b`. One result for ordinary pairs, two for the gender-locked pair.
 * Argument order never changes the outcome: the matrix is symmetric and both gender-locked
 * directions are returned together.
 */
export function breed(ds: Dataset, a: number, b: number): BreedResult[] {
  const n = ds.pals.length
  const cell = ds.matrix[a * n + b]
  if (cell === GENDER_SENTINEL) {
    return ds.combos.genderLocked
      .filter((g) => (g.a === a && g.b === b) || (g.a === b && g.b === a))
      .map((g) => ({
        child: g.child,
        condition: g.aGender === 'F' ? ('gender-AF' as const) : ('gender-AM' as const),
        lock: { aId: ds.pals[g.a].id, aGender: g.aGender, bId: ds.pals[g.b].id, bGender: g.bGender },
      }))
  }
  // Same-species wins over unique: 115 of the unique combos are self-pairs, and the self-pair
  // framing is the one the UI needs to explain.
  if (a === b) return [{ child: cell, condition: 'same-species' }]
  return [{ child: cell, condition: isUniquePair(ds, a, b) ? 'unique' : 'standard' }]
}

/**
 * Badges for a parent pair, always in the order `['unique'?, 'same-species'?]`. Both can apply:
 * 115 of the unique combos are self-pairs. Gender-locked routes are badged by `findParents`,
 * since their matrix cell holds the sentinel rather than a child.
 */
export function badgesFor(ds: Dataset, a: number, b: number): ComboBadge[] {
  const badges: ComboBadge[] = []
  if (isUniquePair(ds, a, b)) badges.push('unique')
  if (a === b) badges.push('same-species')
  return badges
}

/** Every unordered parent pair that produces `target`, gender-locked routes last. */
export function findParents(ds: Dataset, target: number): ParentCombo[] {
  const n = ds.pals.length
  const out: ParentCombo[] = []
  for (let a = 0; a < n; a++) {
    for (let b = a; b < n; b++) {
      if (ds.matrix[a * n + b] === target) out.push({ a, b, badges: badgesFor(ds, a, b) })
    }
  }
  // Gender-locked pairs carry the sentinel in the matrix, so they only surface from combos.
  for (const g of ds.combos.genderLocked) {
    if (g.child !== target) continue
    out.push({ a: Math.min(g.a, g.b), b: Math.max(g.a, g.b), badges: ['gender-locked'] })
  }
  return out
}

/** Every partner for `a`, including `a` itself, in pal-index order. */
export function allCombosFor(ds: Dataset, a: number): ComboEntry[] {
  const out: ComboEntry[] = []
  for (let partner = 0; partner < ds.pals.length; partner++) {
    out.push({ partner, results: breed(ds, a, partner) })
  }
  return out
}
