/**
 * Lowercased-id -> dataset index. `Dataset.byId` is keyed by palcalc's exact-case `InternalName`,
 * and every id that reaches us from outside is not: a hand-typed hash, a link shared from a build
 * that cased them differently, a save's `CharacterID`. One helper rather than the four hand-rolled
 * copies this used to have, so a future normalization rule lands in every consumer at once.
 */
export function buildLowerLookup(byId: Map<string, number>): Map<string, number> {
  const lower = new Map<string, number>()
  for (const [id, index] of byId) lower.set(id.toLowerCase(), index)
  return lower
}
