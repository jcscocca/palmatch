import { deflate } from 'pako'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImportResult, OwnedPal } from '../save/types.ts'
import {
  createOwnedStore,
  decodeOwnedShare,
  encodeOwnedShare,
  MAX_STORED_INDIVIDUALS,
  OWNED_STORAGE_KEY,
  ownedCount,
  ownedShareLink,
  ownedSpeciesIndices,
  parseOwnedShareJson,
  sanitizeShare,
  shareJson,
  shareSpecies,
} from './owned.ts'
import type { OwnedBySpecies } from './owned.ts'

function pal(speciesIndex: number, passives: string[] = []): OwnedPal {
  return { speciesIndex, gender: 'F', passives, talents: null }
}

function result(owned: OwnedPal[], warnings: string[] = []): ImportResult {
  return { owned, unknownSpecies: [], nonPalRows: 1, palCount: owned.length, warnings }
}

/**
 * This suite supplies its own storage. Neither jsdom nor Node's experimental web storage gives a
 * usable `localStorage` under vitest here (Node defines the global first, as an object with no
 * methods, which is itself a fine test of the store's throw-safety — but useless for round-trips).
 */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('owned store', () => {
  it('folds an import into per-species counts and keeps the parser warnings', () => {
    const store = createOwnedStore()
    store.getState().setOwned(result([pal(3), pal(3), pal(7)], ['left out 2 pals']), 'Level.sav')

    const s = store.getState()
    expect(s.bySpecies[3].count).toBe(2)
    expect(s.bySpecies[7].count).toBe(1)
    expect(s.sourceLabel).toBe('Level.sav')
    expect(s.warnings).toEqual(['left out 2 pals'])
    expect(Date.parse(s.importedAt ?? '')).not.toBeNaN()
  })

  it('caps stored individuals per species, keeping the ones with the most passives', () => {
    const store = createOwnedStore()
    const many = [0, 1, 2, 3, 4, 2, 1].map((n, i) => pal(9, Array.from({ length: n }, (_, k) => `p${i}-${k}`)))
    store.getState().setOwned(result(many), 'Level.sav')

    const entry = store.getState().bySpecies[9]
    // The count is exact even though the examples are capped - the cap bounds storage, not truth.
    expect(entry.count).toBe(7)
    expect(entry.individuals).toHaveLength(MAX_STORED_INDIVIDUALS)
    expect(entry.individuals.map((i) => i.passives.length)).toEqual([4, 3, 2, 2, 1])
  })

  it('derives species indices (ascending) and a total pal count', () => {
    const store = createOwnedStore()
    store.getState().setOwned(result([pal(7), pal(3), pal(3)]), 'Level.sav')
    expect(ownedSpeciesIndices(store.getState().bySpecies)).toEqual([3, 7])
    expect(ownedCount(store.getState().bySpecies)).toBe(3)
  })

  it('loadShared installs counts with no individuals, since a link never carries them', () => {
    const store = createOwnedStore()
    store.getState().loadShared(
      [
        [2, 5],
        [4, 1],
      ],
      "Jacob's guild",
    )
    expect(store.getState().bySpecies).toEqual({ 2: { count: 5, individuals: [] }, 4: { count: 1, individuals: [] } })
    expect(store.getState().sourceLabel).toBe("Jacob's guild")
  })

  it('round-trips through localStorage into a fresh store', () => {
    const store = createOwnedStore()
    store.getState().setOwned(result([pal(3, ['Swift']), pal(5)]), 'Level.sav')

    const reloaded = createOwnedStore()
    expect(reloaded.getState().bySpecies).toEqual(store.getState().bySpecies)
    expect(reloaded.getState().sourceLabel).toBe('Level.sav')
    expect(reloaded.getState().importedAt).toBe(store.getState().importedAt)
  })

  it('clearOwned empties the store and leaves nothing behind in storage', () => {
    const store = createOwnedStore()
    store.getState().setOwned(result([pal(3)]), 'Level.sav')
    expect(localStorage.getItem(OWNED_STORAGE_KEY)).not.toBeNull()

    store.getState().clearOwned()
    expect(store.getState().bySpecies).toEqual({})
    expect(store.getState().importedAt).toBeNull()
    expect(localStorage.getItem(OWNED_STORAGE_KEY)).toBeNull()
    expect(createOwnedStore().getState().bySpecies).toEqual({})
  })

  it.each([
    ['not JSON at all', '{oh no'],
    ['a JSON scalar', '"hello"'],
    ['an envelope from a future version', '{"v":2,"data":{"bySpecies":{}}}'],
    ['a species map that is not one', '{"v":1,"data":{"bySpecies":[1,2],"importedAt":null,"sourceLabel":null,"warnings":[]}}'],
    [
      'an entry missing its count',
      '{"v":1,"data":{"bySpecies":{"3":{"individuals":[]}},"importedAt":null,"sourceLabel":null,"warnings":[]}}',
    ],
    [
      'a non-numeric species key',
      '{"v":1,"data":{"bySpecies":{"lamball":{"count":1,"individuals":[]}},"importedAt":null,"sourceLabel":null,"warnings":[]}}',
    ],
  ])('ignores %s rather than starting up broken', (_label, stored) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    localStorage.setItem(OWNED_STORAGE_KEY, stored)

    const store = createOwnedStore()
    expect(store.getState().bySpecies).toEqual({})
    expect(store.getState().importedAt).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('survives a localStorage that throws on every access (Safari private mode)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    })

    const store = createOwnedStore()
    expect(() => store.getState().setOwned(result([pal(3)]), 'Level.sav')).not.toThrow()
    expect(store.getState().bySpecies[3].count).toBe(1)
  })
})

const SAMPLE: OwnedBySpecies = {
  3: { count: 2, individuals: [{ gender: 'F', passives: ['Swift'], talents: null }] },
  11: { count: 1, individuals: [] },
}

describe('share codec', () => {
  it('round-trips species and counts, and leaves individuals out of the payload', () => {
    const blob = encodeOwnedShare(SAMPLE)
    expect(blob).toMatch(/^[A-Za-z0-9_-]+$/)

    const decoded = decodeOwnedShare(blob)
    expect(decoded).toEqual({ v: 1, species: [[3, 2], [11, 1]] })
    expect(JSON.stringify(decoded)).not.toContain('Swift')
  })

  it('builds a link on the current origin and path, with no query string carried over', () => {
    const location = { origin: 'https://example.test', pathname: '/palmatch/' } as Location
    expect(ownedShareLink(SAMPLE, location)).toBe(`https://example.test/palmatch/#/own/${encodeOwnedShare(SAMPLE)}`)
  })

  it.each([
    ['an empty blob', ''],
    ['characters outside base64url', 'not a blob!'],
    ['base64url that is not deflate', 'aGVsbG8gd29ybGQ'],
    ['a deflate stream of the wrong payload', encodeOwnedShareOf('{"v":1,"species":[["3",2]]}')],
    ['a payload from another version', encodeOwnedShareOf('{"v":9,"species":[[3,2]]}')],
    ['a negative species index', encodeOwnedShareOf('{"v":1,"species":[[-1,2]]}')],
    ['a zero count', encodeOwnedShareOf('{"v":1,"species":[[3,0]]}')],
  ])('decodes %s to null instead of throwing', (_label, blob) => {
    expect(() => decodeOwnedShare(blob)).not.toThrow()
    expect(decodeOwnedShare(blob)).toBeNull()
  })

  it('decodes a tampered blob to null', () => {
    const blob = encodeOwnedShare(SAMPLE)
    const flipped = `${blob.slice(0, 4)}${blob[4] === 'A' ? 'B' : 'A'}${blob.slice(5)}`
    expect(decodeOwnedShare(flipped)).toBeNull()
  })

  it('refuses a blob far larger than any real owned list, before inflating it', () => {
    expect(decodeOwnedShare('A'.repeat(20000))).toBeNull()
  })

  it('shares the same payload with the .palmatch.json file', () => {
    expect(parseOwnedShareJson(shareJson(SAMPLE))).toEqual(decodeOwnedShare(encodeOwnedShare(SAMPLE)))
    expect(parseOwnedShareJson('{')).toBeNull()
    expect(parseOwnedShareJson('[]')).toBeNull()
  })

  it('sorts the payload by species index, so the same list always yields the same link', () => {
    const reversed: OwnedBySpecies = { 11: SAMPLE[11], 3: SAMPLE[3] }
    expect(shareSpecies(reversed)).toEqual([
      [3, 2],
      [11, 1],
    ])
    expect(encodeOwnedShare(reversed)).toBe(encodeOwnedShare(SAMPLE))
  })

  it('drops species the receiving build does not have, and says how many', () => {
    expect(sanitizeShare([[1, 2], [900, 1]], 200)).toEqual({ species: [[1, 2]], dropped: 1 })
  })
})

/** Hand-built blobs for the failure table: a real deflate stream around a payload we choose. */
function encodeOwnedShareOf(json: string): string {
  const bytes = deflate(json)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
