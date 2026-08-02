import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenderCode, PalRecord, PassiveRecord } from '../engine/types.ts'
import type { ImportResult, OwnedPal } from '../save/types.ts'
import {
  createOwnedStore,
  genderTotals,
  hasOwnedFor,
  MAX_STORED_INDIVIDUALS,
  onlyGender,
  OWNED_STORAGE_KEY,
  ownedRows,
  ownedSpeciesIndices,
  STORAGE_VERSION,
} from './owned.ts'
import type { OwnedBySpecies, OwnedRow } from './owned.ts'

function pal(speciesIndex: number, passives: string[] = [], gender: GenderCode | null = 'F'): OwnedPal {
  return { speciesIndex, gender, passives, talents: null }
}

function passive(id: string, rank: number): PassiveRecord {
  return { id, name: id, rank, randomAllowed: true, randomWeight: 100, standard: true }
}

function result(owned: OwnedPal[], warnings: string[] = [], playerRows = 1): ImportResult {
  return {
    owned,
    sources: [{ label: 'Level.sav', kind: 'level', palCount: owned.length }],
    unknownSpecies: [],
    unknownPals: 0,
    oddTypes: [],
    playerRows,
    unreadableRows: 0,
    vacantSlots: 0,
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

  it('caps stored individuals per species as a clean breeding portfolio', () => {
    const store = createOwnedStore()
    const many = [0, 1, 2, 3, 4, 2, 1].map((n, i) => pal(9, Array.from({ length: n }, (_, k) => `p${i}-${k}`)))
    store.getState().setOwned(result(many), 'Level.sav')

    const entry = store.getState().bySpecies[9]
    // The count is exact even though the examples are capped - the cap bounds storage, not truth.
    expect(entry.count).toBe(7)
    expect(entry.individuals).toHaveLength(MAX_STORED_INDIVIDUALS)
    expect(entry.individuals.map((i) => i.passives.length)).toEqual([0, 1, 1, 2, 2])
  })

  it('covers distinct elite passives before taking duplicate carriers', () => {
    const store = createOwnedStore()
    const records = [passive('Lucky', 4), passive('Legend', 4), passive('Artisan', 3), passive('Bad', -1)]
    const many = [
      pal(9, [], 'F'),
      pal(9, [], 'M'),
      pal(9, ['Lucky', 'Bad'], 'F'),
      pal(9, ['Lucky'], 'M'),
      pal(9, ['Legend', 'Bad'], 'F'),
      pal(9, ['Artisan'], 'M'),
      pal(9, ['Bad'], 'F'),
    ]
    store.getState().setOwned(result(many), 'Level.sav', records)

    const kept = store.getState().bySpecies[9].individuals.map((individual) => individual.passives)
    expect(kept).toContainEqual([])
    expect(kept).toContainEqual(['Lucky'])
    expect(kept).toContainEqual(['Legend', 'Bad'])
  })

  it('tallies genders over every pal, not over the individuals it kept', () => {
    // Six of one species: five males carrying passives, and the only female carrying none. The
    // portfolio now keeps that especially useful clean female, while the exact tally still remains
    // independent of whichever examples fit under the cap.
    const store = createOwnedStore()
    const males = [1, 2, 3, 4, 5].map((n) => pal(9, Array.from({ length: n }, (_, k) => `m${n}-${k}`), 'M'))
    store.getState().setOwned(result([...males, pal(9, [], 'F')]), 'Level.sav')

    const entry = store.getState().bySpecies[9]
    expect(entry.count).toBe(6)
    expect(entry.individuals).toHaveLength(MAX_STORED_INDIVIDUALS)
    expect(entry.individuals.map((i) => i.gender)).toEqual(['F', 'M', 'M', 'M', 'M'])
    expect(entry.genders).toEqual({ males: 5, females: 1 })
    // And so the species is not flagged unbreedable, which the sample alone would have claimed.
    expect(onlyGender(entry.count, entry.genders)).toBeNull()
  })

  it('counts a pal whose save row carried no gender in neither half', () => {
    const store = createOwnedStore()
    store.getState().setOwned(result([pal(4, [], 'M'), pal(4, [], null), pal(4, [], null)]), 'Level.sav')

    const entry = store.getState().bySpecies[4]
    expect(entry.count).toBe(3)
    // `males + females < count`, which is why nothing may call this species male-only: either
    // unrecorded pal could be the female that makes it breedable.
    expect(entry.genders).toEqual({ males: 1, females: 0 })
    expect(onlyGender(entry.count, entry.genders)).toBeNull()
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
    expect(store.getState().bySpecies).toEqual({ 2: { count: 5, genders: null, individuals: [] }, 4: { count: 1, genders: null, individuals: [] } })
    expect(store.getState().sourceLabel).toBe("Jacob's guild")
  })

  it('loadShared takes the split when the link carried one, and calls it unknown when it did not', () => {
    const store = createOwnedStore()
    store.getState().loadShared([[2, 5, 3, 2], [4, 1]], "Jacob's guild")
    expect(store.getState().bySpecies).toEqual({
      2: { count: 5, genders: { males: 3, females: 2 }, individuals: [] },
      4: { count: 1, genders: null, individuals: [] },
    })
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

  it('stores genders under the current envelope version and reads them back', () => {
    const store = createOwnedStore()
    store.getState().setOwned(result([pal(3, [], 'M'), pal(3, [], 'F'), pal(3, [], 'M')]), 'Level.sav')

    const stored = JSON.parse(localStorage.getItem(OWNED_STORAGE_KEY) ?? '{}') as { v: number }
    expect(stored.v).toBe(STORAGE_VERSION)
    expect(createOwnedStore().getState().bySpecies[3].genders).toEqual({ males: 2, females: 1 })
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
    ['an envelope from a future version', '{"v":3,"data":{"bySpecies":{}}}'],
    // A v2 entry must say something about its genders, even if that something is `null`. One that
    // says nothing was not written by this build, and inferring "unknown" from a missing field
    // would let a hand-edited or half-written blob decide how the tallies are read.
    [
      'a v2 entry with no genders field at all',
      '{"v":2,"data":{"bySpecies":{"3":{"count":1,"individuals":[]}},"importedAt":null,"sourceLabel":null,"warnings":[]}}',
    ],
    [
      'a genders block missing a half',
      '{"v":2,"data":{"bySpecies":{"3":{"count":2,"genders":{"males":1},"individuals":[]}},"importedAt":null,"sourceLabel":null,"warnings":[]}}',
    ],
    [
      'a fractional gender tally',
      '{"v":2,"data":{"bySpecies":{"3":{"count":2,"genders":{"males":1.5,"females":0},"individuals":[]}},"importedAt":null,"sourceLabel":null,"warnings":[]}}',
    ],
    [
      'a negative gender tally',
      '{"v":2,"data":{"bySpecies":{"3":{"count":2,"genders":{"males":-1,"females":3},"individuals":[]}},"importedAt":null,"sourceLabel":null,"warnings":[]}}',
    ],
    [
      // The split may fall short of the count (ungendered pals) but can never outrun it — that
      // would render a tally the ×N beside it contradicts.
      'a split that outnumbers the count it belongs to',
      '{"v":2,"data":{"bySpecies":{"3":{"count":2,"genders":{"males":2,"females":1},"individuals":[]}},"importedAt":null,"sourceLabel":null,"warnings":[]}}',
    ],
    [
      'a genders block that is not an object',
      '{"v":2,"data":{"bySpecies":{"3":{"count":2,"genders":7,"individuals":[]}},"importedAt":null,"sourceLabel":null,"warnings":[]}}',
    ],
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

  it('migrates a v1 list, keeping every count and individual and calling the genders unknown', () => {
    // What is in Jacob's browser right now. Nothing may be lost, and nothing may be invented: the
    // per-individual genders a v1 list does carry are a *capped sample*, so deriving tallies from
    // them is exactly the lie this feature was built to avoid. `null` is the only honest answer.
    localStorage.setItem(
      OWNED_STORAGE_KEY,
      '{"v":1,"data":{"bySpecies":{"3":{"count":9,"individuals":[{"gender":"M","passives":["Swift"],"talents":null}]},"7":{"count":1,"individuals":[]}},"importedAt":"2026-07-27T00:00:00.000Z","sourceLabel":"Level.sav","warnings":["left out 2 pals"],"playerRows":4}}',
    )

    const s = createOwnedStore().getState()
    expect(s.bySpecies[3].count).toBe(9)
    expect(s.bySpecies[3].individuals).toEqual([{ gender: 'M', passives: ['Swift'], talents: null }])
    expect(s.bySpecies[3].genders).toBeNull()
    expect(s.bySpecies[7]).toEqual({ count: 1, genders: null, individuals: [] })
    expect(s.sourceLabel).toBe('Level.sav')
    expect(s.warnings).toEqual(['left out 2 pals'])
    expect(s.playerRows).toBe(4)
  })

  it('ignores genders that turn up inside a v1 envelope, rather than trusting them', () => {
    // This build never wrote such a blob, so it has no idea what produced the numbers or whether
    // they were counted over a whole save. Unknown is the only thing it can say about them.
    localStorage.setItem(
      OWNED_STORAGE_KEY,
      '{"v":1,"data":{"bySpecies":{"3":{"count":2,"genders":{"males":2,"females":0},"individuals":[]}},"importedAt":"2026-07-27T00:00:00.000Z","sourceLabel":null,"warnings":[]}}',
    )
    const entry = createOwnedStore().getState().bySpecies[3]
    expect(entry.count).toBe(2)
    expect(entry.genders).toBeNull()
  })

  it('rewrites a migrated list as v2 the next time anything changes', () => {
    localStorage.setItem(
      OWNED_STORAGE_KEY,
      '{"v":1,"data":{"bySpecies":{"3":{"count":2,"individuals":[]}},"importedAt":"2026-07-27T00:00:00.000Z","sourceLabel":null,"warnings":[]}}',
    )
    const store = createOwnedStore()
    // Reading alone leaves the stored blob at v1 — an older build in another tab still finds it.
    expect((JSON.parse(localStorage.getItem(OWNED_STORAGE_KEY) ?? '{}') as { v: number }).v).toBe(1)

    store.getState().setOwned(result([pal(3, [], 'M')]), 'Level.sav')
    expect((JSON.parse(localStorage.getItem(OWNED_STORAGE_KEY) ?? '{}') as { v: number }).v).toBe(STORAGE_VERSION)
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
    0: { count: 1, genders: null, individuals: [] },
    2: { count: 9, genders: null, individuals: [] },
    900: { count: 4, genders: null, individuals: [] },
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
    const tied: OwnedBySpecies = {
      0: { count: 2, genders: null, individuals: [] },
      1: { count: 2, genders: null, individuals: [] },
    }
    expect(ownedRows(fakePals('Zoe', 'Alpha'), tied).map((r) => r.pal.name)).toEqual(['Alpha', 'Zoe'])
  })

  it('carries each species’ split onto its row, so the grid reads one source', () => {
    const withSplit: OwnedBySpecies = {
      0: { count: 3, genders: { males: 2, females: 1 }, individuals: [] },
      1: { count: 2, genders: null, individuals: [] },
    }
    expect(ownedRows(fakePals('Lamball', 'Cattiva'), withSplit).map((r) => r.genders)).toEqual([
      { males: 2, females: 1 },
      null,
    ])
  })

  it('answers "owns anything usable" against the dataset, not against the raw list', () => {
    const staleOnly: OwnedBySpecies = { 900: { count: 4, genders: null, individuals: [] } }
    expect(hasOwnedFor(list, 3)).toBe(true)
    // Four pals in the store, none of them renderable: every control gated on this must stay away.
    expect(hasOwnedFor(staleOnly, 3)).toBe(false)
    expect(hasOwnedFor({}, 3)).toBe(false)
  })
})

describe('onlyGender', () => {
  it.each<[string, number, { males: number; females: number } | null, GenderCode | null]>([
    ['four males and nothing else', 4, { males: 4, females: 0 }, 'M'],
    ['three females and nothing else', 3, { males: 0, females: 3 }, 'F'],
    ['a mixed species', 3, { males: 2, females: 1 }, null],
    // Below two pals it says nothing: "you own one" already explains why it can't pair with itself,
    // and flagging every single-pal species would leave the marker on most of a real palbox.
    ['a lone male', 1, { males: 1, females: 0 }, null],
    // The split falls short of the count, so an unrecorded pal could be the partner.
    ['two males and one pal the save never gendered', 3, { males: 2, females: 0 }, null],
    ['a species with no split at all', 4, null, null],
    ['a species whose pals were all ungendered', 4, { males: 0, females: 0 }, null],
  ])('says %s is %s', (_label, count, genders, expected) => {
    expect(onlyGender(count, genders)).toBe(expected)
  })
})

describe('genderTotals', () => {
  function row(count: number, genders: OwnedRow['genders']): OwnedRow {
    return { index: 0, pal: { name: 'x' } as PalRecord, count, genders }
  }

  it('adds up the whole grid when every species knows its split', () => {
    expect(genderTotals([row(3, { males: 2, females: 1 }), row(2, { males: 0, females: 2 })])).toEqual({
      males: 2,
      females: 3,
    })
  })

  it('refuses a total the grid below it could not account for', () => {
    // One unknown species poisons the headline: a total summed over the rest would be a number
    // nothing on screen adds up to, which is the same lie in a more prominent place.
    expect(genderTotals([row(3, { males: 2, females: 1 }), row(2, null)])).toBeNull()
    expect(genderTotals([])).toBeNull()
  })
})
