import type { StoreApi, UseBoundStore } from 'zustand'
import type { PalRecord } from '../engine/types.ts'
import { buildLowerLookup } from '../lib/lower-lookup.ts'
import { isTabId, modeFor, normalizeSlots } from './store.ts'
import type { TabId, WorkbenchState } from './store.ts'

export interface UrlState {
  slotA: number | null
  slotB: number | null
  target: number | null
  /**
   * Active result-tab id, written into the hash unescaped as `@<tab>`. Ids come from the app's own
   * `TAB_IDS`, never user text, and match `/^[a-z-]+$/` (lowercase letters and hyphens only) so
   * they can never collide with `~`, `+`, `@`, or `/` - the characters the rest of the grammar
   * depends on. A hand-edited hash naming something else parses back as `null`.
   */
  tab: TabId | null
}

const EMPTY_STATE: UrlState = { slotA: null, slotB: null, target: null, tab: null }

export interface ParseResult {
  state: UrlState
  warnings: string[]
  /**
   * The blob from a `#/own/<blob>` owned-list share link. Deliberately not part of `UrlState`: it
   * is a one-shot delivery, not synced state — `bindUrl` hands it to a callback once and then
   * canonicalizes the route away, so the address bar never keeps a 200-species payload in it.
   */
  ownShare?: string
}

function idOf(pals: PalRecord[], index: number): string {
  return pals[index].id.toLowerCase()
}

/**
 * `>` sits in the URL fragment's percent-encode set: `history.replaceState`/`location.hash =`
 * silently rewrite it to `%3E` on write (verified against jsdom, matching real browsers), which
 * broke chain links two ways - parseHash never saw a `>` it could split on, and syncToHash's
 * `window.location.hash === hash` short-circuit could never match its own un-encoded `>` against
 * the browser's encoded copy, so every store write re-issued a `replaceState` call (a throttling
 * risk in Safari). `~` is unreserved and survives untouched, so it's the separator going forward.
 * Parsing stays tolerant of the old `>` and its browser-mangled `%3E`/`%3e` form so links shared
 * before this fix, or hand-typed with `>`, still resolve - see bindUrl's canonicalization, which
 * rewrites any of these back to `~` in the address bar as soon as it sees them.
 */
const CHAIN_SEPARATORS = ['~', '>', '%3E', '%3e']

/**
 * Finds the earliest chain separator in `rest`, by index into `rest` itself. Deliberately does
 * *not* search a `.toUpperCase()`'d copy for case-insensitivity: `toUpperCase()` isn't
 * length-preserving for every character (`"ß".toUpperCase() === "SS"`), so a starter id
 * containing one would shift every index after it, and slicing the *original* `rest` at an index
 * computed from the transformed copy would cut it in the wrong place. Matching both `%3E` and
 * `%3e` as separate literal patterns gets case tolerance for the one case-sensitive piece (the
 * percent-encoded hex digit) without transforming the string at all.
 */
function findChainSeparator(rest: string): { index: number; length: number } | null {
  let best: { index: number; length: number } | null = null
  for (const sep of CHAIN_SEPARATORS) {
    const idx = rest.indexOf(sep)
    if (idx !== -1 && (best === null || idx < best.index)) best = { index: idx, length: sep.length }
  }
  return best
}

/**
 * Canonical hash for the workbench state. Canonical means: re-parsing this string and re-encoding
 * it produces the same string again — even when `s` itself is not canonical (e.g. only `slotB`
 * filled), because `normalizeSlots` is applied before anything is rendered. The `if (x === null)
 * throw` guards below exist only so TypeScript can narrow without an `as number` cast; `modeFor`
 * guarantees they never fire (e.g. `mode === 'chain'` only ever holds when `primary` and
 * `s.target` are both non-null).
 */
export function encodeState(s: UrlState, pals: PalRecord[]): string {
  const mode = modeFor(s)
  const tabSuffix = s.tab === null ? '' : `@${s.tab}`
  const { primary, secondary } = normalizeSlots(s)

  if (mode === 'empty') return '#/'

  if (mode === 'target') {
    if (s.target === null) throw new Error('encodeState: target mode without a target')
    return `#/t/${idOf(pals, s.target)}${tabSuffix}`
  }

  // a-only, pair, and chain all require a primary starter by construction of modeFor.
  if (primary === null) throw new Error('encodeState: mode requires a primary starter')

  if (mode === 'a-only') return `#/a/${idOf(pals, primary)}${tabSuffix}`

  if (mode === 'pair') {
    if (secondary === null) throw new Error('encodeState: pair mode without a second starter')
    return `#/b/${idOf(pals, primary)}+${idOf(pals, secondary)}${tabSuffix}`
  }

  // mode === 'chain'
  if (s.target === null) throw new Error('encodeState: chain mode without a target')
  const rest = secondary !== null ? `+${idOf(pals, secondary)}` : ''
  return `#/c/${idOf(pals, primary)}${rest}~${idOf(pals, s.target)}${tabSuffix}`
}

function resolve(lower: Map<string, number>, id: string, warnings: string[]): number | null {
  const index = lower.get(id.toLowerCase())
  if (index === undefined) {
    warnings.push(`unknown pal '${id}' cleared from link`)
    return null
  }
  return index
}

/**
 * Parses a `#/...` hash into workbench state. Never throws: any grammar violation (bad route,
 * missing ids, empty segments) resets the whole route to the empty state with a warning, while a
 * well-formed route with an id that just doesn't exist only nulls that one slot — the rest of the
 * shared link still loads.
 */
export function parseHash(hash: string, byId: Map<string, number>): ParseResult {
  const warnings: string[] = []
  const withoutHash = hash.startsWith('#') ? hash.slice(1) : hash

  if (withoutHash === '' || withoutHash === '/') {
    return { state: { ...EMPTY_STATE }, warnings }
  }

  let body = withoutHash
  let tab: TabId | null = null
  const at = body.lastIndexOf('@')
  if (at !== -1) {
    // An id this build doesn't have — an older link, a typo — is dropped rather than carried as a
    // tab nothing can select. The rest of the route still loads.
    const raw = body.slice(at + 1)
    tab = isTabId(raw) ? raw : null
    body = body.slice(0, at)
  }

  const parts = body.split('/')
  const malformed = (): ParseResult => {
    warnings.push(`malformed url: ${hash}`)
    return { state: { ...EMPTY_STATE }, warnings }
  }
  if (parts.length !== 3 || parts[0] !== '') return malformed()

  const route = parts[1]
  const rest = parts[2]
  const lower = buildLowerLookup(byId)

  // An owned-list share carries no workbench state at all, so it parses to the empty state plus
  // the blob. The base64url alphabet holds no `@`, `+`, `~` or `/`, so the rest of the grammar
  // above can't have chewed a piece off it before we get here.
  if (route === 'own') {
    if (rest === '') return malformed()
    return { state: { ...EMPTY_STATE }, warnings, ownShare: rest }
  }

  if (route === 'a') {
    if (rest === '') return malformed()
    const slotA = resolve(lower, rest, warnings)
    return { state: { slotA, slotB: null, target: null, tab }, warnings }
  }

  if (route === 't') {
    if (rest === '') return malformed()
    const target = resolve(lower, rest, warnings)
    return { state: { slotA: null, slotB: null, target, tab }, warnings }
  }

  if (route === 'b') {
    const ids = rest.split('+')
    if (ids.length !== 2 || ids.some((id) => id === '')) return malformed()
    const slotA = resolve(lower, ids[0], warnings)
    const slotB = resolve(lower, ids[1], warnings)
    return { state: { slotA, slotB, target: null, tab }, warnings }
  }

  if (route === 'c') {
    const sep = findChainSeparator(rest)
    if (sep === null) return malformed()
    const startersPart = rest.slice(0, sep.index)
    const targetPart = rest.slice(sep.index + sep.length)
    if (startersPart === '' || targetPart === '') return malformed()
    const starterIds = startersPart.split('+')
    if (starterIds.length > 2 || starterIds.some((id) => id === '')) return malformed()
    const slotA = resolve(lower, starterIds[0], warnings)
    const slotB = starterIds.length === 2 ? resolve(lower, starterIds[1], warnings) : null
    const target = resolve(lower, targetPart, warnings)
    return { state: { slotA, slotB, target, tab }, warnings }
  }

  return malformed()
}

/**
 * Bidirectional sync between the store and `window.location.hash`. Store changes replace the hash
 * (no scroll jump, no history entry per keystroke); hash changes — back/forward, a pasted link —
 * replace the store's slots and tab. `chainDepth`/passives are session-local and never touch the URL.
 *
 * Each direction sets a flag while it is driving the other, so the write it causes on the far side
 * is recognized as an echo and skipped rather than bouncing back again.
 *
 * `onWarnings`, if given, is invoked with every `parseHash` result (including an empty array on a
 * clean parse) - Task 8 wires it to a toast ("unknown pal 'xyz' cleared from link").
 *
 * `onOwnShare` is the one-shot half: a `#/own/<blob>` link fires it exactly once with the blob and
 * is then canonicalized out of the address bar by the same self-healing write every other
 * non-canonical route gets. The owned list itself never enters this sync loop - it is not workbench
 * state, and a link that re-imported it on every back/forward would be a trap.
 */
export function bindUrl(
  store: UseBoundStore<StoreApi<WorkbenchState>>,
  pals: PalRecord[],
  byId: Map<string, number>,
  onWarnings?: (warnings: string[]) => void,
  onOwnShare?: (blob: string) => void,
): () => void {
  let applyingFromHash = false
  // Guards against a hypothetical environment where `history.replaceState` synchronously
  // dispatches 'hashchange'. Real browsers never do this - replaceState doesn't fire hashchange
  // at all - but the flag costs nothing and means bindUrl doesn't depend on that non-guarantee.
  let applyingToHash = false

  const syncFromHash = (): void => {
    if (applyingToHash) return
    const { state, warnings, ownShare } = parseHash(window.location.hash, byId)
    onWarnings?.(warnings)
    // parseHash resolves each id independently, so an unknown *first* id (e.g. `#/b/ghostpal
    // +bristla`) can hand back the forbidden {slotA: null, slotB: <index>} shape - parseHash
    // itself has no notion of the store's lone-B invariant. Route it through normalizeSlots
    // before it ever reaches setState, same as setSlot does for store-driven writes, so the
    // invariant holds no matter which of the two write sites put a value in.
    const { primary, secondary } = normalizeSlots(state)
    applyingFromHash = true
    try {
      store.setState({ slotA: primary, slotB: secondary, target: state.target, tab: state.tab })
    } finally {
      applyingFromHash = false
    }
    // After the store write, so the panel this opens is mounted over a workbench that has already
    // settled into the state the link asked for (an owned-share link asks for the empty one).
    if (ownShare !== undefined) onOwnShare?.(ownShare)
    // Whatever just got parsed may not have been canonical - an unknown id nulling a slot, a
    // legacy/mangled chain separator, a lone-B shape from a hand-typed link - so re-derive the
    // hash from the (now-normalized) store and rewrite the address bar to match immediately.
    // This runs on every parse, not just the one at bind time, so back/forward navigation and
    // manual address-bar edits self-heal too, not only the initial page load. The equality
    // short-circuit in syncToHash means this is a no-op whenever the hash was already canonical.
    if (window.location.hash !== '') syncToHash()
  }

  const syncToHash = (): void => {
    if (applyingFromHash) return
    const s = store.getState()
    const hash = encodeState({ slotA: s.slotA, slotB: s.slotB, target: s.target, tab: s.tab }, pals)
    if (window.location.hash === hash) return
    applyingToHash = true
    try {
      window.history.replaceState(null, '', hash)
    } finally {
      applyingToHash = false
    }
  }

  // A page load or pasted link arrives as an initial hash with no store state yet - seed the
  // store from it (syncFromHash's own canonicalization step then corrects the address bar if
  // that hash wasn't already canonical) before wiring the ongoing subscriptions.
  syncFromHash()

  const unsubscribeStore = store.subscribe(syncToHash)
  window.addEventListener('hashchange', syncFromHash)

  return () => {
    unsubscribeStore()
    window.removeEventListener('hashchange', syncFromHash)
  }
}
