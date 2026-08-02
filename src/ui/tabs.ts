import type { Mode, TabId } from '../state/store.ts'

/** Which tabs each mode offers, in display order. The ids themselves are declared in the store. */
export const MODE_TABS: Record<Mode, TabId[]> = {
  empty: [],
  'a-only': ['all-a-combos'],
  pair: ['child', 'mutations', 'passive-odds', 'all-a-combos'],
  target: ['parent-combos', 'via-mutation'],
  chain: ['chains'],
}

export const TAB_LABELS: Record<TabId, string> = {
  child: 'CHILD',
  mutations: 'MUTATIONS',
  'passive-odds': 'PASSIVE PLAN',
  'all-a-combos': 'ALL A-COMBOS',
  'parent-combos': 'PARENT COMBOS',
  'via-mutation': 'VIA MUTATION',
  chains: 'CHAINS',
}

/**
 * The tabs a mode offers, widened by one case: an owned list makes CHAINS reachable from `target`
 * mode. Chains normally need a starter slot — that is what puts the workbench in `chain` mode — but
 * the pals a player owns *are* starters, and they never occupy a slot. Rather than teach `modeFor`
 * about a list that only exists in the browser it was imported in (a shared workbench link has no
 * owned list, so the same URL would resolve to different modes for different people), the extra tab
 * is added here, at the one place that decides what the strip shows.
 *
 * `hasOwned` is passed in, never read from the store, so this file stays a pure table.
 */
export function tabsFor(mode: Mode, hasOwned: boolean): TabId[] {
  return mode === 'target' && hasOwned ? [...MODE_TABS.target, 'chains'] : MODE_TABS[mode]
}

/**
 * The tab actually shown: the stored one when it belongs to this mode, else the mode's first tab.
 * `null` only for `empty`, which has no tabs at all. A stored tab that doesn't survive this is
 * written back to `null` by the Workbench so the URL and the screen can't disagree — which is also
 * what quietly fixes a `#/t/...?tab=chains` link opened by someone with no owned list of their own.
 */
export function activeTabFor(mode: Mode, tab: TabId | null, hasOwned = false): TabId | null {
  const tabs = tabsFor(mode, hasOwned)
  if (tab !== null && tabs.includes(tab)) return tab
  return tabs[0] ?? null
}
