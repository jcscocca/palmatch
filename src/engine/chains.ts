import { GENDER_SENTINEL } from './types.ts'
import type { ChainStep, Dataset } from './types.ts'

/**
 * Cost relaxation over species space, for a player who owns several pals and will only breed what
 * they already own. Cost is total breeds, so a pal whose parents cost 1 and 2 costs 4. Shared
 * subtrees are double-counted by that sum; the greedy tradeoff keeps the relaxation a single pass
 * per round and matches what other breeding calculators report.
 */
function setGrowth(ds: Dataset, starters: number[], target: number, maxDepth: number): ChainStep[] | null {
  const n = ds.pals.length
  const cost = new Int8Array(n).fill(127) // 127 = unreachable so far
  const via = new Int32Array(n).fill(-1) // via = a * n + b
  for (const s of starters) cost[s] = 0

  for (let round = 0; round < maxDepth; round++) {
    let changed = false
    const known: number[] = []
    for (let i = 0; i < n; i++) if (cost[i] <= round) known.push(i)
    for (const a of known) {
      for (const b of known) {
        if (b < a) continue
        const child = ds.matrix[a * n + b]
        if (child === GENDER_SENTINEL) continue
        const alt = cost[a] + cost[b] + 1
        if (alt < cost[child] && alt <= maxDepth) {
          cost[child] = alt
          via[child] = a * n + b
          changed = true
        }
      }
    }
    if (!changed) break
  }
  if (cost[target] > maxDepth) return null

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
  return steps
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
    const reach = (u: number, partner: number, child: number): void => {
      if (seen[child] === 1) return
      seen[child] = 1
      from[child] = u
      partnerOf[child] = partner
      next.push(child)
    }
    for (const u of frontier) {
      for (let partner = 0; partner < n; partner++) {
        const cell = ds.matrix[u * n + partner]
        if (cell !== GENDER_SENTINEL) {
          reach(u, partner, cell)
          continue
        }
        // The one sentinel pair hides two children behind a gender requirement; both are reachable.
        for (const g of ds.combos.genderLocked) {
          if ((g.a === u && g.b === partner) || (g.a === partner && g.b === u)) reach(u, partner, g.child)
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
 */
export function findChains(ds: Dataset, starters: number[], target: number, maxDepth = 6): ChainStep[] | null {
  const owned = [...new Set(starters)]
  if (owned.includes(target)) return []
  return owned.length === 1 ? lineage(ds, owned[0], target, maxDepth) : setGrowth(ds, owned, target, maxDepth)
}
