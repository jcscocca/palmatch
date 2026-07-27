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
