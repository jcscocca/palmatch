import { create } from 'zustand'
import type { StoreApi, UseBoundStore } from 'zustand'

export const DEFAULT_CHAIN_DEPTH = 6
export const MAX_PARENT_PASSIVES = 4

export interface ParentPassives {
  a: string[]
  b: string[]
}

/**
 * Plain state, no actions. Split out from `WorkbenchState` so `initialState()` can return this
 * shape directly instead of hand-listing every action key to omit from the full interface.
 */
export interface WorkbenchData {
  /**
   * Invariant enforced by `setSlot` (see below): `slotB` is never non-null while `slotA` is
   * null. Readers - the UI, the URL codec - can rely on that and never need to re-derive it.
   */
  slotA: number | null
  slotB: number | null
  target: number | null
  /** Active result tab id; null means "default tab for the current mode". */
  tab: string | null
  chainDepth: number
  /** Passive ids the player has declared for each parent, max 4 each. */
  parentPassives: ParentPassives
  desiredPassives: string[]
}

export interface WorkbenchActions {
  setSlot(slot: 'a' | 'b' | 't', v: number | null): void
  setTab(tab: string | null): void
  setChainDepth(d: number): void
  setParentPassives(side: 'a' | 'b', ids: string[]): void
  setDesiredPassives(ids: string[]): void
  clearAll(): void
}

export type WorkbenchState = WorkbenchData & WorkbenchActions

export type Mode = 'empty' | 'a-only' | 'pair' | 'target' | 'chain'

export interface SlotState {
  slotA: number | null
  slotB: number | null
  target: number | null
}

/**
 * `slotB` filled while `slotA` is empty has no dedicated meaning in the mode table, so it is
 * normalized to look like a lone starter: `primary` is whichever of A/B is filled first, and
 * `secondary` only exists when A itself was the one filled (i.e. both slots are genuinely in
 * play). This is the one place that normalization happens; `modeFor` and the URL codec both
 * build on it so they can't disagree about what "A only" or "chain from B" means.
 *
 * `setSlot` additionally enforces this shape as a store invariant (a lone starter always lands
 * in `slotA`, never `slotB`), so in practice `s.slotB` alone is never what triggers this path.
 * It stays here as a safety net for callers who build `SlotState` by hand (the URL codec parses
 * routes where a `b`-only shape could otherwise arise) rather than through the store.
 */
export function normalizeSlots(s: SlotState): { primary: number | null; secondary: number | null } {
  const primary = s.slotA ?? s.slotB
  const secondary = s.slotA !== null ? s.slotB : null
  return { primary, secondary }
}

/**
 * Which result panel set applies, per the slots-filled table in the design spec. `chain` only
 * requires a primary starter and a target — a second starter is optional and doesn't change the
 * mode.
 */
export function modeFor(s: SlotState): Mode {
  const { primary, secondary } = normalizeSlots(s)
  if (primary !== null && s.target !== null) return 'chain'
  if (primary !== null && secondary !== null) return 'pair'
  if (s.target !== null) return 'target'
  if (primary !== null) return 'a-only'
  return 'empty'
}

function initialState(): WorkbenchData {
  return {
    slotA: null,
    slotB: null,
    target: null,
    tab: null,
    chainDepth: DEFAULT_CHAIN_DEPTH,
    parentPassives: { a: [], b: [] },
    desiredPassives: [],
  }
}

/**
 * A fresh store instance. The app uses the singleton below; tests use this directly so runs
 * don't share state.
 */
export function createWorkbenchStore(): UseBoundStore<StoreApi<WorkbenchState>> {
  return create<WorkbenchState>((set) => ({
    ...initialState(),
    setSlot: (slot, v) =>
      set((state) => {
        let slotA = state.slotA
        let slotB = state.slotB
        let target = state.target
        if (slot === 'a') slotA = v
        else if (slot === 'b') slotB = v
        else target = v

        // Enforce the "slotB never held while slotA is null" invariant right here, the one
        // place slots are written, rather than leaving every reader to re-derive it:
        //  - filling B while A is empty promotes it to A (setSlot('b', v) becomes the pal's
        //    *only* slot, same as calling setSlot('a', v));
        //  - clearing A while B is still filled shifts B down into A instead of leaving a
        //    B-only state behind.
        if (slotA === null && slotB !== null) {
          slotA = slotB
          slotB = null
        }

        const next = { slotA, slotB, target }
        // A tab id only makes sense within the mode it was chosen under. Clear it when the mode
        // actually changes, but leave it alone for a same-mode edit - e.g. swapping parent B for
        // a different pal in pair mode shouldn't kick the player off the tab they're looking at.
        const tab = modeFor(state) === modeFor(next) ? state.tab : null
        return { ...next, tab }
      }),
    setTab: (tab) => set({ tab }),
    setChainDepth: (d) => set({ chainDepth: d }),
    setParentPassives: (side, ids) =>
      set((state) => ({
        parentPassives: { ...state.parentPassives, [side]: ids.slice(0, MAX_PARENT_PASSIVES) },
      })),
    setDesiredPassives: (ids) => set({ desiredPassives: ids }),
    clearAll: () => set(initialState()),
  }))
}

export const useWorkbenchStore = createWorkbenchStore()
