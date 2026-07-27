import type { StoreApi, UseBoundStore } from 'zustand'
import type { PalRecord } from '../engine/types.ts'
import { modeFor, normalizeSlots } from './store.ts'
import type { WorkbenchState } from './store.ts'

export interface UrlState {
  slotA: number | null
  slotB: number | null
  target: number | null
  tab: string | null
}

const EMPTY_STATE: UrlState = { slotA: null, slotB: null, target: null, tab: null }

export interface ParseResult {
  state: Partial<UrlState>
  warnings: string[]
}

function idOf(pals: PalRecord[], index: number): string {
  return pals[index].id.toLowerCase()
}

/**
 * Canonical hash for the workbench state. Canonical means: re-parsing this string and re-encoding
 * it produces the same string again — even when `s` itself is not canonical (e.g. only `slotB`
 * filled), because `normalizeSlots` is applied before anything is rendered.
 */
export function encodeState(s: UrlState, pals: PalRecord[]): string {
  const mode = modeFor(s)
  const tabSuffix = s.tab !== null && s.tab !== '' ? `@${s.tab}` : ''
  const { primary, secondary } = normalizeSlots(s)

  switch (mode) {
    case 'empty':
      return '#/'
    case 'a-only':
      return `#/a/${idOf(pals, primary as number)}${tabSuffix}`
    case 'pair':
      return `#/b/${idOf(pals, primary as number)}+${idOf(pals, secondary as number)}${tabSuffix}`
    case 'target':
      return `#/t/${idOf(pals, s.target as number)}${tabSuffix}`
    case 'chain': {
      const rest = secondary !== null ? `+${idOf(pals, secondary)}` : ''
      return `#/c/${idOf(pals, primary as number)}${rest}>${idOf(pals, s.target as number)}${tabSuffix}`
    }
  }
}

/** Builds a lowercase-id -> index lookup once per parse; `byId` itself is keyed by exact case. */
function buildLowerLookup(byId: Map<string, number>): Map<string, number> {
  const lower = new Map<string, number>()
  for (const [id, index] of byId) lower.set(id.toLowerCase(), index)
  return lower
}

function resolve(lower: Map<string, number>, id: string, warnings: string[]): number | null {
  const index = lower.get(id.toLowerCase())
  if (index === undefined) {
    warnings.push(`unknown pal id '${id}'`)
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
  let tab: string | null = null
  const at = body.lastIndexOf('@')
  if (at !== -1) {
    tab = body.slice(at + 1) || null
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
    const gt = rest.indexOf('>')
    if (gt === -1) return malformed()
    const startersPart = rest.slice(0, gt)
    const targetPart = rest.slice(gt + 1)
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
 */
export function bindUrl(
  store: UseBoundStore<StoreApi<WorkbenchState>>,
  pals: PalRecord[],
  byId: Map<string, number>,
): () => void {
  let applyingFromHash = false
  let applyingToHash = false

  const syncFromHash = (): void => {
    if (applyingToHash) return
    const { state } = parseHash(window.location.hash, byId)
    applyingFromHash = true
    try {
      store.setState({
        slotA: state.slotA ?? null,
        slotB: state.slotB ?? null,
        target: state.target ?? null,
        tab: state.tab ?? null,
      })
    } finally {
      applyingFromHash = false
    }
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

  // A page load or pasted link arrives as an initial hash with no store state yet — seed the
  // store from it before wiring the ongoing subscriptions.
  syncFromHash()

  const unsubscribeStore = store.subscribe(syncToHash)
  window.addEventListener('hashchange', syncFromHash)

  return () => {
    unsubscribeStore()
    window.removeEventListener('hashchange', syncFromHash)
  }
}
