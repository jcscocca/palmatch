/** P(the child inherits exactly k = 1..4 passives from the parents' pool). */
const K_WEIGHTS = [0.4, 0.3, 0.2, 0.1]

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1)
  return r
}

/**
 * P(the child directly inherits every desired passive) when the parents' combined pool holds
 * `poolSize` passives, `desiredCount` of them wanted. An estimate of direct inheritance only: the
 * random passives the game may add on top can only help, so the real odds are a little better.
 */
export function passiveOdds(poolSize: number, desiredCount: number): number {
  if (desiredCount === 0) return 1
  if (desiredCount > Math.min(poolSize, 4)) return 0
  let p = 0
  for (let k = desiredCount; k <= Math.min(4, poolSize); k++) {
    p += K_WEIGHTS[k - 1] * (choose(poolSize - desiredCount, k - desiredCount) / choose(poolSize, k))
  }
  return p
}

/**
 * P(the child directly inherits exactly the desired set and no other passive from the parents).
 * This is the clean-combo counterpart to `passiveOdds`, which allows additional inherited
 * passives. Random-fill passives are outside both estimates and are called out by the UI.
 */
export function exactPassiveOdds(poolSize: number, desiredCount: number): number {
  if (desiredCount <= 0 || desiredCount > Math.min(poolSize, 4)) return 0
  return K_WEIGHTS[desiredCount - 1] / choose(poolSize, desiredCount)
}

export interface AttemptEstimate {
  /** Mean of the geometric distribution, rounded up to whole eggs. */
  average: number
  /** Eggs by which at least one success has a 90% chance of having appeared. */
  p90: number
}

/** Egg-count context for a per-egg success chance, or null when the roll cannot succeed. */
export function attemptEstimate(chance: number): AttemptEstimate | null {
  if (chance <= 0) return null
  if (chance >= 1) return { average: 1, p90: 1 }
  return {
    average: Math.ceil(1 / chance),
    p90: Math.ceil(Math.log(0.1) / Math.log(1 - chance)),
  }
}
