import { GENDER_SENTINEL } from './types.ts'
import type { ChainStep, Dataset } from './types.ts'

/**
 * Extra cost the relaxation is allowed to explore past `maxDepth`. Cost double-counts shared
 * subtrees while the emitted steps dedupe them, so a chain worth keeping can be scored a little
 * over budget; the reconstructed step count is what the answer is finally judged against.
 */
const COST_SLACK = 2

/**
 * Children of `a` x `b`: the matrix cell, or — for the one pair whose cell is the sentinel — both
 * gender-locked children, since either is one breed away. The single place the breeding rules are
 * read, so the two chain modes cannot drift apart.
 */
function childrenOf(ds: Dataset, a: number, b: number): number[] {
  const cell = ds.matrix[a * ds.pals.length + b]
  if (cell !== GENDER_SENTINEL) return [cell]
  return ds.combos.genderLocked
    .filter((g) => (g.a === a && g.b === b) || (g.a === b && g.b === a))
    .map((g) => g.child)
}

/**
 * Cost relaxation over species space, for a player who owns several pals and will only breed what
 * they already own. Cost is total breeds, so a pal whose parents cost 1 and 2 costs 4. Shared
 * subtrees are double-counted by that sum; the greedy tradeoff keeps the relaxation a single pass
 * per round and matches what other breeding calculators report.
 */
function setGrowth(ds: Dataset, starters: number[], target: number, maxDepth: number): ChainStep[] | null {
  const n = ds.pals.length
  const cap = maxDepth + COST_SLACK
  const cost = new Int8Array(n).fill(127) // 127 = unreachable so far
  const via = new Int32Array(n).fill(-1) // via = a * n + b
  for (const s of starters) cost[s] = 0

  // A round that changes nothing is not a fixed point: `known` admits pals by cost, so the pals a
  // quiet round bred are only paired up some rounds later. Run every round to the cap.
  for (let round = 0; round < cap; round++) {
    const known: number[] = []
    for (let i = 0; i < n; i++) if (cost[i] <= round) known.push(i)
    for (const a of known) {
      for (const b of known) {
        if (b < a) continue
        const alt = cost[a] + cost[b] + 1
        if (alt > cap) continue
        for (const child of childrenOf(ds, a, b)) {
          if (alt < cost[child]) {
            cost[child] = alt
            via[child] = a * n + b
          }
        }
      }
    }
  }
  if (cost[target] > cap) return null

  // `via` cannot cycle: a child is only recorded at a cost strictly above both parents' costs at
  // that moment, and costs only fall afterwards, so cost drops on every hop back through `via`.
  const steps: ChainStep[] = []
  const emit = (p: number): void => {
    if (via[p] < 0) return
    const a = Math.floor(via[p] / n)
    const b = via[p] % n
    emit(a)
    emit(b)
    if (!steps.some((s) => s.child === p)) steps.push({ a, b, child: p })
  }
  emit(target)
  // Deduped steps are the real cost; the relaxation's over-count only guided the search.
  return steps.length <= maxDepth ? steps : null
}

/**
 * Breadth-first search down one lineage for a player who owns a single pal and can catch whatever
 * partner a step calls for. An edge exists when any of the 299 pals, paired with the pal in hand,
 * gives the next pal. Partners are scanned in index order, so the lowest-index partner wins ties.
 */
function lineage(ds: Dataset, starter: number, target: number, maxDepth: number): ChainStep[] | null {
  const n = ds.pals.length
  const from = new Int32Array(n).fill(-1)
  const partnerOf = new Int32Array(n).fill(-1)
  const seen = new Uint8Array(n)
  seen[starter] = 1

  let frontier = [starter]
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: number[] = []
    for (const u of frontier) {
      for (let partner = 0; partner < n; partner++) {
        for (const child of childrenOf(ds, u, partner)) {
          if (seen[child] === 1) continue
          seen[child] = 1
          from[child] = u
          partnerOf[child] = partner
          next.push(child)
        }
      }
    }
    if (seen[target] === 1) break
    frontier = next
  }
  if (seen[target] === 0) return null

  const steps: ChainStep[] = []
  for (let cur = target; cur !== starter; cur = from[cur]) {
    steps.push({ a: from[cur], b: partnerOf[cur], child: cur })
  }
  return steps.reverse()
}

/**
 * The shortest breeding chain from what the player owns to `target`, or null if there is none
 * within `maxDepth` breeds. Semantics depend on how much the player has:
 *
 * - one starter: the chain runs down a single lineage and each step may pair it with any pal,
 *   since catching one partner is cheaper than breeding it;
 * - two or more: only pals the player owns or has already bred may be paired, so the owned set
 *   grows strictly and `maxDepth` counts total breeds rather than generations.
 *
 * The two modes make the answer non-monotonic in the starter set: Lamball alone reaches Relaxaurus
 * Lux in two breeds by catching partners, while Lamball plus Alpaca — now held to what they own —
 * reaches it in none. Adding a starter can turn a chain into null; that is the mode switch, not a
 * search failure.
 */
export function findChains(ds: Dataset, starters: number[], target: number, maxDepth = 6): ChainStep[] | null {
  const owned = [...new Set(starters)]
  if (owned.includes(target)) return []
  return owned.length === 1 ? lineage(ds, owned[0], target, maxDepth) : setGrowth(ds, owned, target, maxDepth)
}
