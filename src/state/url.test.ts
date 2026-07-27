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

  it('chain with a single starter, omitting the +<b> segment', () => {
    const s: UrlState = { slotA: 0, slotB: null, target: 2, tab: null }
    expect(encodeState(s, PALS)).toBe('#/c/foxparks>grizzbolt')
    expect(parseHash('#/c/foxparks>grizzbolt', BY_ID)).toEqual({ state: s, warnings: [] })
  })

  it('chain with two starters', () => {
    const s: UrlState = { slotA: 0, slotB: 1, target: 2, tab: null }
    expect(encodeState(s, PALS)).toBe('#/c/foxparks+bristla>grizzbolt')
    expect(parseHash('#/c/foxparks+bristla>grizzbolt', BY_ID)).toEqual({ state: s, warnings: [] })
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
    expect(encodeState(state as UrlState, PALS)).toBe(hash)
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
})

/** A minimal, controllable stand-in for `window` so bindUrl's reentrancy guard can be exercised deterministically. */
function fakeWindow(initialHash: string) {
  const location = { hash: initialHash }
  const listeners: Array<() => void> = []
  const replaceState = vi.fn((_state: unknown, _title: string, url: string) => {
    const i = url.indexOf('#')
    location.hash = i === -1 ? '' : url.slice(i)
  })
  return {
    location,
    history: { replaceState },
    addEventListener: (_type: 'hashchange', listener: () => void) => listeners.push(listener),
    removeEventListener: (_type: 'hashchange', listener: () => void) => {
      const i = listeners.indexOf(listener)
      if (i !== -1) listeners.splice(i, 1)
    },
    fireHashChange: () => listeners.forEach((l) => l()),
  }
}

describe('bindUrl', () => {
  let win: ReturnType<typeof fakeWindow>

  beforeEach(() => {
    win = fakeWindow('')
    vi.stubGlobal('window', win)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes store changes to the hash via history.replaceState', () => {
    const store = createWorkbenchStore()
    const unbind = bindUrl(store, PALS, BY_ID)
    store.getState().setSlot('a', 0)
    store.getState().setSlot('b', 1)
    expect(win.location.hash).toBe('#/b/foxparks+bristla')
    expect(win.history.replaceState).toHaveBeenCalled()
    unbind()
  })

  it('seeds the store from whatever hash is already present when bound', () => {
    win.location.hash = '#/a/bristla'
    const store = createWorkbenchStore()
    const unbind = bindUrl(store, PALS, BY_ID)
    expect(store.getState().slotA).toBe(1)
    unbind()
  })

  it('applies a hashchange (back/forward, pasted link) to the store', () => {
    const store = createWorkbenchStore()
    const unbind = bindUrl(store, PALS, BY_ID)
    win.location.hash = '#/t/grizzbolt'
    win.fireHashChange()
    expect(store.getState().target).toBe(2)
    unbind()
  })

  it('does not bounce a hashchange-driven store update back into another replaceState call', () => {
    const store = createWorkbenchStore()
    const unbind = bindUrl(store, PALS, BY_ID)
    const callsBefore = win.history.replaceState.mock.calls.length
    win.location.hash = '#/t/grizzbolt'
    win.fireHashChange()
    expect(win.history.replaceState.mock.calls.length).toBe(callsBefore)
    unbind()
  })

  it('stops syncing in either direction after unbind', () => {
    const store = createWorkbenchStore()
    const unbind = bindUrl(store, PALS, BY_ID)
    unbind()

    const callsBefore = win.history.replaceState.mock.calls.length
    store.getState().setSlot('t', 2)
    expect(win.history.replaceState.mock.calls.length).toBe(callsBefore)

    win.location.hash = '#/a/bristla'
    win.fireHashChange()
    expect(store.getState().slotA).toBeNull()
  })
})
