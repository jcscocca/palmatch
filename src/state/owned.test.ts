import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PalRecord } from '../engine/types.ts'
import type { ImportResult, OwnedPal } from '../save/types.ts'
import {
  createOwnedStore,
  hasOwnedFor,
  MAX_STORED_INDIVIDUALS,
  OWNED_STORAGE_KEY,
  ownedRows,
  ownedSpeciesIndices,
} from './owned.ts'
import type { OwnedBySpecies } from './owned.ts'

function pal(speciesIndex: number, passives: string[] = []): OwnedPal {
  return { speciesIndex, gender: 'F', passives, talents: null }
}

function result(owned: OwnedPal[], warnings: string[] = [], playerRows = 1): ImportResult {
  return {
    owned,
    unknownSpecies: [],
    unknownPals: 0,
    oddTypes: [],
    playerRows,
    unreadableRows: 0,
    palCount: owned.length,
    warnings,
  }
}

/** Only `name` is read by anything under test, so the rest of a `PalRecord` is not built. */
function fakePals(...names: string[]): PalRecord[] {
  return names.map((name) => ({ name })) as PalRecord[]
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

  it('carries the save’s player count, so the summary can say whose palbox this is', () => {
    const store = createOwnedStore()
    store.getState().setOwned(result([pal(3)], [], 4), 'Level.sav')
    expect(store.getState().playerRows).toBe(4)

    // A shared list is species and counts; there is no guild behind it to report.
    store.getState().loadShared([[3, 1]], 'shared list')
    expect(store.getState().playerRows).toBe(0)
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

  it('derives species indices ascending', () => {
    const store = createOwnedStore()
    store.getState().setOwned(result([pal(7), pal(3), pal(3)]), 'Level.sav')
    expect(ownedSpeciesIndices(store.getState().bySpecies)).toEqual([3, 7])
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
    store.getState().setOwned(result([pal(3, ['Swift']), pal(5)], [], 2), 'Level.sav')

    const reloaded = createOwnedStore()
    expect(reloaded.getState().bySpecies).toEqual(store.getState().bySpecies)
    expect(reloaded.getState().sourceLabel).toBe('Level.sav')
    expect(reloaded.getState().importedAt).toBe(store.getState().importedAt)
    expect(reloaded.getState().playerRows).toBe(2)
  })

  it('writes only the data fields, never anything the store hangs off state', () => {
    const store = createOwnedStore()
    store.getState().setOwned(result([pal(3)]), 'Level.sav')

    const stored = JSON.parse(localStorage.getItem(OWNED_STORAGE_KEY) ?? '{}') as { data: Record<string, unknown> }
    expect(Object.keys(stored.data).sort()).toEqual(['bySpecies', 'importedAt', 'playerRows', 'sourceLabel', 'warnings'])
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
    [
      'a fractional count',
      '{"v":1,"data":{"bySpecies":{"3":{"count":1.5,"individuals":[]}},"importedAt":null,"sourceLabel":null,"warnings":[]}}',
    ],
    [
      'a count that overflowed into Infinity',
      '{"v":1,"data":{"bySpecies":{"3":{"count":1e400,"individuals":[]}},"importedAt":null,"sourceLabel":null,"warnings":[]}}',
    ],
    [
      // `Number.isInteger(1e21)` is true, which is exactly why this validates with `isSafeInteger`.
      'a count past the safe-integer range',
      '{"v":1,"data":{"bySpecies":{"3":{"count":1e21,"individuals":[]}},"importedAt":null,"sourceLabel":null,"warnings":[]}}',
    ],
    [
      'an individual that is not one',
      '{"v":1,"data":{"bySpecies":{"3":{"count":1,"individuals":[7]}},"importedAt":null,"sourceLabel":null,"warnings":[]}}',
    ],
    [
      'a negative player count',
      '{"v":1,"data":{"bySpecies":{},"importedAt":null,"sourceLabel":null,"warnings":[],"playerRows":-1}}',
    ],
  ])('ignores %s rather than starting up broken', (_label, stored) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    localStorage.setItem(OWNED_STORAGE_KEY, stored)

    const store = createOwnedStore()
    expect(store.getState().bySpecies).toEqual({})
    expect(store.getState().importedAt).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it.each([
    ['a talent that is not a number', '{"hp":"nope","shot":1,"defense":1}'],
    ['an array where the IVs should be', '[]'],
    ['only some of the three', '{"hp":50}'],
    ['a scalar', '7'],
  ])('keeps a list whose IVs are %s, reading them as unknown rather than as zeroes', (_label, talents) => {
    localStorage.setItem(
      OWNED_STORAGE_KEY,
      `{"v":1,"data":{"bySpecies":{"3":{"count":1,"individuals":[{"gender":"F","passives":[],"talents":${talents}}]}},"importedAt":"2026-07-27T00:00:00.000Z","sourceLabel":"Level.sav","warnings":[]}}`,
    )

    const store = createOwnedStore()
    // The species survives — losing a whole palbox over one unreadable IV block would be absurd —
    // but the IVs are null, which already means "this save never said", not "all zeroes".
    expect(store.getState().bySpecies[3].count).toBe(1)
    expect(store.getState().bySpecies[3].individuals[0].talents).toBeNull()
  })

  it('keeps a full set of numeric IVs', () => {
    localStorage.setItem(
      OWNED_STORAGE_KEY,
      '{"v":1,"data":{"bySpecies":{"3":{"count":1,"individuals":[{"gender":"F","passives":[],"talents":{"hp":80,"shot":55,"defense":30}}]}},"importedAt":"2026-07-27T00:00:00.000Z","sourceLabel":null,"warnings":[]}}',
    )
    expect(createOwnedStore().getState().bySpecies[3].individuals[0].talents).toEqual({ hp: 80, shot: 55, defense: 30 })
  })

  it('reads a list stored before the player count existed', () => {
    localStorage.setItem(
      OWNED_STORAGE_KEY,
      '{"v":1,"data":{"bySpecies":{"3":{"count":1,"individuals":[]}},"importedAt":"2026-07-27T00:00:00.000Z","sourceLabel":"Level.sav","warnings":[]}}',
    )
    const store = createOwnedStore()
    expect(store.getState().playerRows).toBe(0)
    expect(store.getState().bySpecies[3].count).toBe(1)
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

describe('dataset-aware selectors', () => {
  const list: OwnedBySpecies = {
    0: { count: 1, individuals: [] },
    2: { count: 9, individuals: [] },
    900: { count: 4, individuals: [] },
  }

  it('renders most-owned first, dropping species this build has never heard of', () => {
    const rows = ownedRows(fakePals('Lamball', 'Cattiva', 'Chikipi'), list)
    // 900 is gone entirely, and its 4 pals go with it — which is why the summary totals these rows
    // rather than the store.
    expect(rows.map((r) => [r.pal.name, r.count])).toEqual([
      ['Chikipi', 9],
      ['Lamball', 1],
    ])
  })

  it('breaks a count tie by name, so the grid does not reshuffle between renders', () => {
    const tied: OwnedBySpecies = { 0: { count: 2, individuals: [] }, 1: { count: 2, individuals: [] } }
    expect(ownedRows(fakePals('Zoe', 'Alpha'), tied).map((r) => r.pal.name)).toEqual(['Alpha', 'Zoe'])
  })

  it('answers "owns anything usable" against the dataset, not against the raw list', () => {
    const staleOnly: OwnedBySpecies = { 900: { count: 4, individuals: [] } }
    expect(hasOwnedFor(list, 3)).toBe(true)
    // Four pals in the store, none of them renderable: every control gated on this must stay away.
    expect(hasOwnedFor(staleOnly, 3)).toBe(false)
    expect(hasOwnedFor({}, 3)).toBe(false)
  })
})
