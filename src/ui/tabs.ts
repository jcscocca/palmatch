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
  'passive-odds': 'PASSIVE ODDS',
  'all-a-combos': 'ALL A-COMBOS',
  'parent-combos': 'PARENT COMBOS',
  'via-mutation': 'VIA MUTATION',
  chains: 'CHAINS',
}

/**
 * The tab actually shown: the stored one when it belongs to this mode, else the mode's first tab.
 * `null` only for `empty`, which has no tabs at all. A stored tab that doesn't survive this is
 * written back to `null` by the Workbench so the URL and the screen can't disagree.
 */
export function activeTabFor(mode: Mode, tab: TabId | null): TabId | null {
  const tabs = MODE_TABS[mode]
  if (tab !== null && tabs.includes(tab)) return tab
  return tabs[0] ?? null
}
