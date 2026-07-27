import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PalRecord } from '../engine/types.ts'
import { createWorkbenchStore } from './store.ts'
import { bindUrl, encodeState, parseHash } from './url.ts'
import type { UrlState } from './url.ts'

function mk(id: string): PalRecord {
  return { id, name: id, dex: '1', types: ['normal'], power: 1, priority: 1, maleProb: 0.5, guaranteed: [], sprite: `/sprites/${id}.webp` }
}

// Ids are mixed-case InternalNames, as they are everywhere else in the engine; the URL grammar
// lowercases them, and lookups must be case-insensitive to match back.
const PALS: PalRecord[] = [mk('Foxparks'), mk('Bristla'), mk('Grizzbolt')]
const BY_ID = new Map(PALS.map((p, i) => [p.id, i]))
const EMPTY: UrlState = { slotA: null, slotB: null, target: null, tab: null }

describe('encodeState / parseHash round-trip', () => {
  it('empty state', () => {
    expect(encodeState(EMPTY, PALS)).toBe('#/')
    expect(parseHash('#/', BY_ID)).toEqual({ state: EMPTY, warnings: [] })
    expect(parseHash('', BY_ID)).toEqual({ state: EMPTY, warnings: [] })
  })

  it('a-only', () => {
    const s: UrlState = { slotA: 1, slotB: null, target: null, tab: null }
    expect(encodeState(s, PALS)).toBe('#/a/bristla')
    expect(parseHash('#/a/bristla', BY_ID)).toEqual({ state: s, warnings: [] })
  })

  it('pair, in stored slot order', () => {
    const s: UrlState = { slotA: 0, slotB: 1, target: null, tab: null }
    expect(encodeState(s, PALS)).toBe('#/b/foxparks+bristla')
    expect(parseHash('#/b/foxparks+bristla', BY_ID)).toEqual({ state: s, warnings: [] })
  })

  it('target', () => {
    const s: UrlState = { slotA: null, slotB: null, target: 2, tab: null }
    expect(encodeState(s, PALS)).toBe('#/t/grizzbolt')
    expect(parseHash('#/t/grizzbolt', BY_ID)).toEqual({ state: s, warnings: [] })
  })

  it('chain with a single starter, omitting the +<b> segment, using the fragment-safe ~ separator', () => {
    const s: UrlState = { slotA: 0, slotB: null, target: 2, tab: null }
    expect(encodeState(s, PALS)).toBe('#/c/foxparks~grizzbolt')
    expect(parseHash('#/c/foxparks~grizzbolt', BY_ID)).toEqual({ state: s, warnings: [] })
  })

  it('chain with two starters', () => {
    const s: UrlState = { slotA: 0, slotB: 1, target: 2, tab: null }
    expect(encodeState(s, PALS)).toBe('#/c/foxparks+bristla~grizzbolt')
    expect(parseHash('#/c/foxparks+bristla~grizzbolt', BY_ID)).toEqual({ state: s, warnings: [] })
  })

  it('carries an optional @tab suffix on every form', () => {
    const s: UrlState = { slotA: 0, slotB: 1, target: null, tab: 'mutations' }
    expect(encodeState(s, PALS)).toBe('#/b/foxparks+bristla@mutations')
    expect(parseHash('#/b/foxparks+bristla@mutations', BY_ID)).toEqual({ state: s, warnings: [] })
  })

  it('resolves ids case-insensitively', () => {
    expect(parseHash('#/b/FOXPARKS+Bristla', BY_ID)).toEqual({
      state: { slotA: 0, slotB: 1, target: null, tab: null },
      warnings: [],
    })
  })

  it('canonicalizes a lone slot B into slot A (normalizeSlots), and that is a fixed point', () => {
    const raw: UrlState = { slotA: null, slotB: 1, target: null, tab: null }
    const hash = encodeState(raw, PALS)
    expect(hash).toBe('#/a/bristla')
    const { state } = parseHash(hash, BY_ID)
    expect(encodeState(state, PALS)).toBe(hash)
  })

  it('parses legacy/browser-mangled chain separators (>, %3E) the same as the canonical ~', () => {
    const expected = { state: { slotA: 0, slotB: null, target: 2, tab: null }, warnings: [] }
    expect(parseHash('#/c/foxparks~grizzbolt', BY_ID)).toEqual(expected)
    expect(parseHash('#/c/foxparks>grizzbolt', BY_ID)).toEqual(expected)
    expect(parseHash('#/c/foxparks%3Egrizzbolt', BY_ID)).toEqual(expected)
    expect(parseHash('#/c/foxparks%3egrizzbolt', BY_ID)).toEqual(expected) // lowercase hex digit
  })
})

describe('parseHash edge cases', () => {
  it('nulls just the bad slot and warns, keeping the rest of a well-formed route', () => {
    const { state, warnings } = parseHash('#/b/foxparks+ghostpal', BY_ID)
    expect(state).toEqual({ slotA: 0, slotB: null, target: null, tab: null })
    expect(warnings).toEqual(["unknown pal id 'ghostpal'"])
  })

  it('warns for an unknown a-only id', () => {
    const { state, warnings } = parseHash('#/a/ghostpal', BY_ID)
    expect(state).toEqual({ slotA: null, slotB: null, target: null, tab: null })
    expect(warnings).toEqual(["unknown pal id 'ghostpal'"])
  })

  it.each(['#/b/', '#/c/x>', '#/zzz'])('treats malformed hash %s as empty state with a warning, never throwing', (hash) => {
    expect(() => parseHash(hash, BY_ID)).not.toThrow()
    const { state, warnings } = parseHash(hash, BY_ID)
    expect(state).toEqual(EMPTY)
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('does not let a length-changing uppercase fold (ß -> "SS") misalign the chain-separator split', () => {
    // Regression: the separator search used to run on rest.toUpperCase() but slice the original
    // string. toUpperCase() isn't length-preserving for every character - "ß".toUpperCase() ===
    // "SS" - so a starter id containing one shifted every index after it in the uppercased copy,
    // and slicing the original at that shifted index cut it in the wrong place. Searching the
    // untransformed string keeps the split aligned regardless of what's in the starter id, even
    // one (like this one) that's bogus and expected to resolve to nothing either way - the point
    // is that the *target* on the other side of the separator still comes out correct.
    const { state, warnings } = parseHash('#/c/foßparks~grizzbolt', BY_ID)
    expect(state).toEqual({ slotA: null, slotB: null, target: 2, tab: null })
    expect(warnings).toEqual(["unknown pal id 'foßparks'"])
  })
})

/**
 * bindUrl reads/writes the real `window`, and the bug this suite guards against (chain URLs
 * getting mangled) is specifically about what a real URL implementation does to `>` on write -
 * so these tests run against the actual jsdom `window` rather than a hand-rolled stand-in.
 * `HashChangeEvent` is dispatched manually because jsdom does not fire it on a bare
 * `location.hash = ...` assignment (verified directly against jsdom; real browsers do fire it
 * for that assignment, but not for `history.replaceState`, which is the asymmetry this module
 * depends on).
 */
describe('bindUrl', () => {
  beforeEach(() => {
    window.location.hash = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function fireHashChange(hash: string): void {
    window.location.hash = hash
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }

  it('writes store changes to the hash via history.replaceState', () => {
    const store = createWorkbenchStore()
    const unbind = bindUrl(store, PALS, BY_ID)
    store.getState().setSlot('a', 0)
    store.getState().setSlot('b', 1)
    expect(window.location.hash).toBe('#/b/foxparks+bristla')
    unbind()
  })

  it('seeds the store from whatever hash is already present when bound', () => {
    window.location.hash = '#/a/bristla'
    const store = createWorkbenchStore()
    const unbind = bindUrl(store, PALS, BY_ID)
    expect(store.getState().slotA).toBe(1)
    unbind()
  })

  it('applies an external hashchange (back/forward, pasted link) to the store', () => {
    const store = createWorkbenchStore()
    const unbind = bindUrl(store, PALS, BY_ID)
    fireHashChange('#/t/grizzbolt')
    expect(store.getState().target).toBe(2)
    unbind()
  })

  it('does not bounce a hashchange-driven store update back into another replaceState call', () => {
    const store = createWorkbenchStore()
    const unbind = bindUrl(store, PALS, BY_ID)
    const spy = vi.spyOn(window.history, 'replaceState')
    fireHashChange('#/t/grizzbolt')
    expect(spy).not.toHaveBeenCalled()
    unbind()
  })

  it('stops syncing in either direction after unbind', () => {
    const store = createWorkbenchStore()
    const unbind = bindUrl(store, PALS, BY_ID)
    unbind()

    const spy = vi.spyOn(window.history, 'replaceState')
    store.getState().setSlot('t', 2)
    expect(spy).not.toHaveBeenCalled()

    fireHashChange('#/a/bristla')
    expect(store.getState().slotA).toBeNull()
  })

  it('does not rewrite a genuinely blank initial hash on bind', () => {
    const spy = vi.spyOn(window.history, 'replaceState')
    const store = createWorkbenchStore()
    const unbind = bindUrl(store, PALS, BY_ID)
    expect(spy).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('')
    unbind()
  })

  it('round-trips chain mode through a real URL fragment (fragment-safe ~ separator)', () => {
    const store = createWorkbenchStore()
    const unbind = bindUrl(store, PALS, BY_ID)
    store.getState().setSlot('a', 0)
    store.getState().setSlot('b', 1)
    store.getState().setSlot('t', 2)
    expect(window.location.hash).toBe('#/c/foxparks+bristla~grizzbolt')
    unbind()

    // A fresh load (or a second tab) at that exact address-bar URL.
    const store2 = createWorkbenchStore()
    const unbind2 = bindUrl(store2, PALS, BY_ID)
    expect(store2.getState()).toMatchObject({ slotA: 0, slotB: 1, target: 2 })
    unbind2()
  })

  it('self-heals a legacy chain link (old > separator) in the address bar immediately on bind', () => {
    window.location.hash = '#/c/foxparks>grizzbolt'
    const store = createWorkbenchStore()
    const unbind = bindUrl(store, PALS, BY_ID)
    expect(store.getState()).toMatchObject({ slotA: 0, target: 2 })
    expect(window.location.hash).toBe('#/c/foxparks~grizzbolt')
    unbind()
  })

  it('short-circuits once window.location.hash already matches the canonical hash (Safari replaceState throttling)', () => {
    const store = createWorkbenchStore()
    const unbind = bindUrl(store, PALS, BY_ID)
    store.getState().setSlot('a', 0)
    store.getState().setSlot('t', 2)
    expect(window.location.hash).toBe('#/c/foxparks~grizzbolt')

    // Changing chainDepth never touches the URL, so the hash the store would compute hasn't
    // moved - with the fragment-safe separator, window.location.hash already equals it exactly,
    // and the equality short-circuit should skip every one of these ten writes.
    const spy = vi.spyOn(window.history, 'replaceState')
    for (let i = 0; i < 10; i++) store.getState().setChainDepth(4 + (i % 5))
    expect(spy).not.toHaveBeenCalled()
    unbind()
  })

  it('invokes onWarnings on every parse, including a clean one with an empty array', () => {
    window.location.hash = '#/b/foxparks+ghostpal'
    const seen: string[][] = []
    const store = createWorkbenchStore()
    const unbind = bindUrl(store, PALS, BY_ID, (w) => seen.push(w))
    expect(seen).toEqual([["unknown pal id 'ghostpal'"]])

    fireHashChange('#/t/grizzbolt')
    expect(seen).toEqual([["unknown pal id 'ghostpal'"], []])
    unbind()
  })

  it('normalizes an unknown-FIRST-id pair link so the store never holds the forbidden lone-B shape', () => {
    // parseHash resolves each id independently: an unknown first id in "#/b/ghostpal+bristla"
    // hands back {slotA: null, slotB: <bristla>} on its own. Writing that straight into the
    // store via setState (bypassing setSlot's normalization) would violate the "slotB never held
    // while slotA is null" invariant - syncFromHash has to normalize before it calls setState.
    window.location.hash = '#/b/ghostpal+bristla'
    const store = createWorkbenchStore()
    const unbind = bindUrl(store, PALS, BY_ID)
    expect(store.getState()).toMatchObject({ slotA: 1, slotB: null, target: null })
    expect(window.location.hash).toBe('#/a/bristla')
    unbind()
  })

  it('normalizes an unknown-FIRST-id chain link the same way', () => {
    window.location.hash = '#/c/ghostpal+bristla~grizzbolt'
    const store = createWorkbenchStore()
    const unbind = bindUrl(store, PALS, BY_ID)
    expect(store.getState()).toMatchObject({ slotA: 1, slotB: null, target: 2 })
    expect(window.location.hash).toBe('#/c/bristla~grizzbolt')
    unbind()
  })

  it('normalizes and canonicalizes on a hashchange too, not just at bind time', () => {
    const store = createWorkbenchStore()
    const unbind = bindUrl(store, PALS, BY_ID)
    fireHashChange('#/b/ghostpal+bristla')
    expect(store.getState()).toMatchObject({ slotA: 1, slotB: null, target: null })
    expect(window.location.hash).toBe('#/a/bristla')
    unbind()
  })
})
