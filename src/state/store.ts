import { create } from 'zustand'
import type { StoreApi, UseBoundStore } from 'zustand'

export const DEFAULT_CHAIN_DEPTH = 6
export const MAX_PARENT_PASSIVES = 4

export interface ParentPassives {
  a: string[]
  b: string[]
}

export interface WorkbenchState {
  slotA: number | null
  slotB: number | null
  target: number | null
  /** Active result tab id; null means "default tab for the current mode". */
  tab: string | null
  chainDepth: number
  /** Passive ids the player has declared for each parent, max 4 each. */
  parentPassives: ParentPassives
  desiredPassives: string[]
  setSlot(slot: 'a' | 'b' | 't', v: number | null): void
  setTab(tab: string | null): void
  setChainDepth(d: number): void
  setParentPassives(side: 'a' | 'b', ids: string[]): void
  setDesiredPassives(ids: string[]): void
  clearAll(): void
}

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

function initialState(): Omit<WorkbenchState, 'setSlot' | 'setTab' | 'setChainDepth' | 'setParentPassives' | 'setDesiredPassives' | 'clearAll'> {
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
    setSlot: (slot, v) => {
      // Any slot change can move the workbench into a different mode, so a tab id chosen under
      // the old mode may no longer exist. Clearing it lets the UI fall back to that mode's default.
      if (slot === 'a') set({ slotA: v, tab: null })
      else if (slot === 'b') set({ slotB: v, tab: null })
      else set({ target: v, tab: null })
    },
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
