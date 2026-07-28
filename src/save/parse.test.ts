import { beforeAll, describe, expect, it } from 'vitest'
import { loadDatasetFromDisk } from '../engine/dataset.ts'
import type { Dataset } from '../engine/types.ts'
import { buildLowerLookup } from '../lib/lower-lookup.ts'
import { cnk0, junkFile, levelGvas, plm1, plz1, plz2, storageGvas, truncateTo, type PalSpec } from './fixtures/builder.ts'
import { MAX_SAVE_BYTES, parseSave, parseSaveSet, parseStorageSave } from './parse.ts'
import { codeOf, detailOf } from './test-utils.ts'
import { ParseError, type ImportResult } from './types.ts'

let ds: Dataset
let byIdLower: Map<string, number>

/** The species ids are real, so the fixtures exercise the same lookup the app will. */
beforeAll(async () => {
  ds = await loadDatasetFromDisk('public/data')
  byIdLower = buildLowerLookup(ds.byId)
})

function idx(id: string): number {
  const index = byIdLower.get(id.toLowerCase())
  if (index === undefined) throw new Error(`unknown pal: ${id}`)
  return index
}

const WORLD: PalSpec[] = [
  { characterId: 'SheepBall', gender: 'Female', passives: ['Legend', 'Swift'], talents: { hp: 80, shot: 55, defense: 30 } },
  { characterId: 'BOSS_CatMage', gender: 'Male', talents: { hp: 100 }, clutter: true },
  { characterId: 'LazyDragon', gender: 'Male', passives: [], nickName: 'ねむい' },
  { characterId: null, gender: null, isPlayer: true, nickName: 'Jacob' },
]

/** What the fixture actually encodes: rows with a CharacterID that aren't flagged as the player. */
const ENCODED_PALS = WORLD.filter((p) => p.characterId !== null && p.isPlayer !== true).length

function parse(buffer: ArrayBuffer): Promise<ImportResult> {
  return parseSave(buffer, byIdLower)
}

describe('parseSave', () => {
  it('reads a whole PlZ1 world, excluding the player row', async () => {
    const result = await parse(plz1(levelGvas({ pals: WORLD })))

    expect(result.palCount).toBe(3)
    expect(result.playerRows).toBe(1)
    expect(result.unreadableRows).toBe(0)
    expect(result.unknownSpecies).toEqual([])
    expect(result.owned).toEqual([
      {
        speciesIndex: idx('SheepBall'),
        gender: 'F',
        passives: ['Legend', 'Swift'],
        talents: { hp: 80, shot: 55, defense: 30 },
      },
      { speciesIndex: idx('CatMage'), gender: 'M', passives: [], talents: { hp: 100, shot: 0, defense: 0 } },
      { speciesIndex: idx('LazyDragon'), gender: 'M', passives: [], talents: null },
    ])
  })

  it('reads the same world out of a PlZ2 double-deflate save', async () => {
    const once = await parse(plz1(levelGvas({ pals: WORLD })))
    const twice = await parse(plz2(levelGvas({ pals: WORLD })))
    expect(twice).toEqual(once)
  })

  it('reads a PlM1 save through the injected Oodle decompressor', async () => {
    const gvas = levelGvas({ pals: WORLD })
    const result = await parseSave(plm1(gvas), byIdLower, () => Promise.resolve(() => gvas))
    expect(result.owned).toHaveLength(3)
  })

  it('collects species it cannot place instead of failing', async () => {
    const pals: PalSpec[] = [
      { characterId: 'SheepBall' },
      { characterId: 'NewPalFrom2027' },
      { characterId: 'GYM_ThunderDragonMan' },
      { characterId: 'NewPalFrom2027' },
    ]
    const result = await parse(plz1(levelGvas({ pals })))

    expect(result.owned.map((p) => p.speciesIndex)).toEqual([idx('SheepBall')])
    expect(result.unknownSpecies).toEqual(['GYM_ThunderDragonMan', 'NewPalFrom2027'])
    expect(result.unknownPals).toBe(3)
    expect(result.palCount).toBe(4)
    // Three pals lost to two species — the warning counts pals, since that's what the user missed.
    expect(result.warnings).toEqual(["left out 3 pals whose species palmatch doesn't know: GYM_ThunderDragonMan, NewPalFrom2027"])
  })

  it('warns instead of reporting zeroes when IVs are stored in a shape we do not know', async () => {
    // If a future patch moves Talent_* to some third type, the failure mode must be visible: a
    // silently 0-IV world looks entirely plausible and would be believed.
    const pals: PalSpec[] = [
      { characterId: 'SheepBall', talents: { hp: 80, shot: 55, defense: 30 }, talentType: 'float' },
      { characterId: 'CatMage', talents: { hp: 90 }, talentType: 'float' },
    ]
    const result = await parse(plz1(levelGvas({ pals })))

    expect(result.owned).toHaveLength(2)
    expect(result.owned.map((p) => p.talents)).toEqual([null, null])
    // Structured as well as prose: anything but a `<p>` should be reading these.
    expect(result.oddTypes).toEqual([
      'Talent_Defense (FloatProperty)',
      'Talent_HP (FloatProperty)',
      'Talent_Shot (FloatProperty)',
    ])
    expect(result.warnings).toEqual([
      "this save stores Talent_Defense (FloatProperty), Talent_HP (FloatProperty), Talent_Shot (FloatProperty) in a form palmatch doesn't recognise, so those IVs were left blank",
    ])
  })

  it('says nothing when there is nothing to say', async () => {
    const result = await parse(plz1(levelGvas({ pals: WORLD })))
    expect(result.warnings).toEqual([])
  })

  it('handles a world with no pals in it', async () => {
    const result = await parse(plz1(levelGvas({ pals: [] })))
    expect(result).toEqual({
      owned: [],
      sources: [{ label: 'Level.sav', kind: 'level', palCount: 0 }],
      unknownSpecies: [],
      unknownPals: 0,
      oddTypes: [],
      playerRows: 0,
      unreadableRows: 0,
      vacantSlots: 0,
      palCount: 0,
      warnings: [],
    })
  })

  it('counts a row with no CharacterID as unreadable, not as a player', async () => {
    // The two used to be one `nonPalRows` tally, which made "guild of N players" a guess. A row
    // with neither an id nor an IsPlayer flag is a damaged row, and says nothing about the guild.
    const result = await parse(
      plz1(levelGvas({ pals: [{ characterId: 'SheepBall' }, { characterId: null }, { characterId: null, isPlayer: true }] })),
    )
    expect(result.palCount).toBe(1)
    expect(result.playerRows).toBe(1)
    expect(result.unreadableRows).toBe(1)
  })

  it('reads 200 entries with the counts intact', async () => {
    const pals = Array.from({ length: 200 }, (_, i): PalSpec => ({
      characterId: i % 2 === 0 ? 'SheepBall' : 'CatMage',
      gender: i % 3 === 0 ? 'Male' : 'Female',
      talents: { hp: i % 101 },
      clutter: i % 5 === 0,
    }))
    const result = await parse(plz1(levelGvas({ pals })))
    expect(result.owned).toHaveLength(200)
    expect(result.owned.filter((p) => p.gender === 'M')).toHaveLength(67)
    expect(result.owned[6].talents).toEqual({ hp: 6, shot: 0, defense: 0 })
  })
})

describe('parseStorageSave', () => {
  it('reads a flat SaveParameterArray, which has no RawData indirection at all', async () => {
    // The one place a storage file diverges from Level.sav: the pal's SaveParameter sits directly in
    // the array element, beside an InstanceId struct, rather than inside a RawData byte blob
    // (`PC CharacterInstanceVisitor.cs:422` against `:361`).
    const result = await parseStorageSave(
      plz1(storageGvas({ pals: WORLD.filter((p) => p.isPlayer !== true) })),
      byIdLower,
    )

    expect(result.palCount).toBe(3)
    expect(result.owned.map((p) => p.speciesIndex)).toEqual([idx('SheepBall'), idx('CatMage'), idx('LazyDragon')])
    expect(result.owned[0]).toEqual({
      speciesIndex: idx('SheepBall'),
      gender: 'F',
      passives: ['Legend', 'Swift'],
      talents: { hp: 80, shot: 55, defense: 30 },
    })
    expect(result.sources).toEqual([{ label: 'storage', kind: 'storage', palCount: 3 }])
  })

  it('counts an empty slot as vacant, not as a damaged row', async () => {
    // A Dimensional Pal Storage is ~9,600 slots recycled in place, so almost every element is empty.
    // Calling those unreadable would bury a real problem under thousands of false ones.
    const result = await parseStorageSave(
      plz1(storageGvas({ pals: [{ characterId: 'SheepBall' }, null, null, { characterId: 'CatMage' }, null] })),
      byIdLower,
    )
    expect(result.palCount).toBe(2)
    expect(result.vacantSlots).toBe(3)
    expect(result.unreadableRows).toBe(0)
    expect(result.warnings).toEqual([])
  })

  it('reads the same storage file out of a PlZ2 double-deflate wrapper', async () => {
    const pals: PalSpec[] = [{ characterId: 'SheepBall' }, { characterId: 'CatMage', clutter: true }]
    const once = await parseStorageSave(plz1(storageGvas({ pals })), byIdLower)
    const twice = await parseStorageSave(plz2(storageGvas({ pals })), byIdLower)
    expect(twice).toEqual(once)
  })

  it('walks past a sibling root property to reach the array', async () => {
    const result = await parseStorageSave(plz1(storageGvas({ pals: [{ characterId: 'SheepBall' }], padBytes: 4096 })), byIdLower)
    expect(result.palCount).toBe(1)
  })

  it('names a Level.sav handed to it as a storage file', async () => {
    expect(await codeOf(parseStorageSave(plz1(levelGvas()), byIdLower))).toBe('wrong-file')
    expect(await detailOf(parseStorageSave(plz1(levelGvas()), byIdLower))).toMatch(/no SaveParameterArray/)
  })

  it('catches an array whose elements do not add up to its declared size', async () => {
    const drifted = plz1(storageGvas({ pals: [{ characterId: 'SheepBall' }], corruptArraySize: 16 }))
    expect(await codeOf(parseStorageSave(drifted, byIdLower))).toBe('skip-drift')
    expect(await detailOf(parseStorageSave(drifted, byIdLower))).toMatch(/SaveParameterArray.*declares/)
  })
})

describe('parseSaveSet', () => {
  const level = (pals: PalSpec[]): ArrayBuffer => plz1(levelGvas({ pals }))
  const storage = (label: string, pals: Array<PalSpec | null>): { label: string; buffer: ArrayBuffer } => ({
    label,
    buffer: plz1(storageGvas({ pals })),
  })

  it('sums counts and genders across every file, and names what it read', async () => {
    const result = await parseSaveSet(
      level([{ characterId: 'SheepBall', gender: 'Female' }, { characterId: null, isPlayer: true }]),
      [
        storage('a_dps.sav', [{ characterId: 'SheepBall', gender: 'Male' }, null, { characterId: 'CatMage', gender: 'Male' }]),
        storage('GlobalPalStorage.sav', [{ characterId: 'SheepBall', gender: 'Female' }]),
      ],
      byIdLower,
    )

    expect(result.palCount).toBe(4)
    expect(result.playerRows).toBe(1)
    expect(result.vacantSlots).toBe(1)
    expect(result.owned.filter((p) => p.speciesIndex === idx('SheepBall'))).toHaveLength(3)
    expect(result.owned.filter((p) => p.gender === 'M')).toHaveLength(2)
    expect(result.owned.filter((p) => p.gender === 'F')).toHaveLength(2)
    expect(result.sources).toEqual([
      { label: 'Level.sav', kind: 'level', palCount: 1 },
      { label: 'a_dps.sav', kind: 'storage', palCount: 2 },
      { label: 'GlobalPalStorage.sav', kind: 'storage', palCount: 1 },
    ])
    expect(result.warnings).toEqual([])
  })

  it('pools individuals across files rather than capping each one', async () => {
    // The 5-per-species cap lives in the owned store and runs over everything at once, so the pals
    // reaching it must arrive in one list — a player whose best Lamball sits in Dimensional Pal
    // Storage would otherwise never see it.
    const result = await parseSaveSet(
      level([{ characterId: 'SheepBall', passives: ['Runner'] }]),
      [storage('a_dps.sav', [{ characterId: 'SheepBall', passives: ['Legend', 'Swift', 'Musclehead'] }])],
      byIdLower,
    )
    expect(result.owned.map((p) => p.passives)).toEqual([['Runner'], ['Legend', 'Swift', 'Musclehead']])
  })

  it('unions the species and IV-shape warnings instead of repeating them per file', async () => {
    const result = await parseSaveSet(
      level([{ characterId: 'NewPalFrom2027' }, { characterId: 'SheepBall', talents: { hp: 1 }, talentType: 'float' }]),
      [
        storage('a_dps.sav', [{ characterId: 'NewPalFrom2027' }, { characterId: 'AlsoUnknown' }]),
        storage('b_dps.sav', [{ characterId: 'SheepBall', talents: { hp: 2 }, talentType: 'float' }]),
      ],
      byIdLower,
    )

    expect(result.unknownSpecies).toEqual(['AlsoUnknown', 'NewPalFrom2027'])
    expect(result.unknownPals).toBe(3)
    expect(result.oddTypes).toEqual(['Talent_HP (FloatProperty)'])
    // One sentence each, over the merged totals — not one per file that happened to hit the same thing.
    expect(result.warnings).toEqual([
      "left out 3 pals whose species palmatch doesn't know: AlsoUnknown, NewPalFrom2027",
      "this save stores Talent_HP (FloatProperty) in a form palmatch doesn't recognise, so those IVs were left blank",
    ])
  })

  it('degrades a corrupt storage file to a warning and keeps the Level.sav result', async () => {
    // A `_dps.sav` may be missing, half-written or from a game version we don't know. Losing the
    // whole import over one would be a bad trade — losing a broken Level.sav is not optional.
    const result = await parseSaveSet(
      level([{ characterId: 'SheepBall' }]),
      [
        { label: 'broken_dps.sav', buffer: junkFile() },
        storage('good_dps.sav', [{ characterId: 'CatMage' }]),
      ],
      byIdLower,
    )

    expect(result.owned.map((p) => p.speciesIndex)).toEqual([idx('SheepBall'), idx('CatMage')])
    expect(result.sources.map((s) => s.label)).toEqual(['Level.sav', 'good_dps.sav'])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatch(/^couldn't read broken_dps\.sav, so any pals kept in it are not counted: /)
  })

  it('still fails outright when the Level.sav is the broken one', async () => {
    expect(await codeOf(parseSaveSet(junkFile(), [storage('a_dps.sav', [{}])], byIdLower))).toBe('unknown-magic')
  })

  it('is exactly parseSave when there are no storage files', async () => {
    const bytes = levelGvas({ pals: WORLD })
    expect(await parseSaveSet(plz1(bytes), [], byIdLower)).toEqual(await parseSave(plz1(bytes), byIdLower))
  })
})

describe('parseSave failures', () => {
  it('refuses an oversized file before reading a byte of it', async () => {
    // Only `byteLength` is touched on this path, so there's no need to allocate half a gigabyte.
    const huge = { byteLength: MAX_SAVE_BYTES + 1 } as ArrayBuffer
    expect(await codeOf(parse(huge))).toBe('too-large')
  })

  it('names an Xbox save', async () => {
    expect(await codeOf(parse(cnk0(plz1(levelGvas()))))).toBe('xbox-save')
  })

  it('rejects a file that is not a save', async () => {
    expect(await codeOf(parse(junkFile()))).toBe('unknown-magic')
  })

  it('rejects a wrapper holding something that is not GVAS', async () => {
    expect(await codeOf(parse(plz1(new Uint8Array(512).fill(7))))).toBe('not-a-save')
  })

  it('rejects a half-copied file', async () => {
    expect(await codeOf(parse(truncateTo(plz1(levelGvas()), 60)))).toBe('truncated')
  })

  it('names the wrong Palworld save for what it is', async () => {
    const meta = plz1(levelGvas({ omitWorldSaveData: true, className: '/Script/Pal.PalLevelMetaSaveGame' }))
    expect(await codeOf(parse(meta))).toBe('wrong-file')
    expect(await detailOf(parse(meta))).toMatch(/PalLevelMetaSaveGame.*Level\.sav/s)
  })

  it('stops on a property whose declared size is wrong, rather than inventing pals', async () => {
    const drifted = plz1(levelGvas({ pals: WORLD, padBytes: 256, corruptPadSize: 12 }))
    expect(await codeOf(parse(drifted))).toBe('skip-drift')
  })

  it('catches a map whose entries do not add up to its declared size', async () => {
    const drifted = plz1(levelGvas({ pals: WORLD, corruptMapSize: 16 }))
    expect(await codeOf(parse(drifted))).toBe('skip-drift')
    expect(await detailOf(parse(drifted))).toMatch(/CharacterSaveParameterMap.*declares/)
  })
})

describe('parseSave on corrupted saves', () => {
  /** mulberry32, so the same bytes are corrupted on every run. */
  function seeded(seed: number): () => number {
    let s = seed
    return () => {
      s = (s + 0x6d2b79f5) | 0
      let t = Math.imul(s ^ (s >>> 15), 1 | s)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  /**
   * Every byte of a save is attacker-controlled as far as we're concerned: a half-synced Steam
   * folder is enough. Whatever a corrupted file does, it has to end in a ParseError we have copy
   * for — never a raw TypeError, never a hang, never a plausible-looking pal invented from noise.
   */
  it('answers with a known code, never an unhandled throw, for 200 corrupted variants', async () => {
    const clean = levelGvas({ pals: WORLD })
    const rand = seeded(20260727)
    const codes = new Set<string>()
    let parsed = 0

    for (let i = 0; i < 200; i++) {
      const damaged = clean.slice()
      const at = Math.floor(rand() * damaged.length)
      damaged[at] = Math.floor(rand() * 256)

      let result: ImportResult | null = null
      try {
        result = await parse(plz1(damaged))
      } catch (error) {
        expect(error).toBeInstanceOf(ParseError)
        codes.add((error as ParseError).code)
      }
      if (result !== null) {
        parsed++
        // A flipped bit inside a name or an IV still parses, and may cost us a row — corrupting
        // "RawData" itself leaves an entry we can't read. What it must never do is produce a row
        // the fixture didn't encode, or a pal whose contents are noise dressed up as data.
        expect(result.palCount).toBeLessThanOrEqual(ENCODED_PALS)
        // Every row reached is in one of the three tallies, damaged or not — a corrupted entry
        // becomes unreadable rather than vanishing from the arithmetic. Bounded rather than equal
        // because a flipped bit in the map's own entry count makes the walk stop early, so the
        // three can sum to fewer rows than the fixture wrote; they must never sum to more.
        expect(result.palCount + result.playerRows + result.unreadableRows).toBeLessThanOrEqual(WORLD.length)
        for (const pal of result.owned) {
          expect(ds.pals[pal.speciesIndex]).toBeDefined()
          for (const iv of Object.values(pal.talents ?? {})) {
            // The IV range the game uses. A desync reading garbage as an IntProperty lands here.
            expect(iv).toBeGreaterThanOrEqual(0)
            expect(iv).toBeLessThanOrEqual(255)
          }
          // Structural invariant only: the fixture encodes at most 2 passives per pal, and a
          // desync perturbs the count. Content is deliberately NOT asserted — a byte flipped
          // inside a passive's own string bytes yields a non-printable character, which is the
          // parser faithfully reporting corrupted data, not a parsing defect.
          expect(pal.passives.length).toBeLessThanOrEqual(2)
        }
      }
    }

    expect(parsed).toBeGreaterThan(0)
    // Damaging the GVAS magic, the `worldSaveData` name, a size field or a length: one code each.
    expect([...codes].sort()).toEqual(['not-a-save', 'skip-drift', 'truncated', 'wrong-file'])
  })
})

describe('parseSave performance', () => {
  it('walks past a 10 MB sibling branch without materializing it', async () => {
    const save = plz1(levelGvas({ pals: WORLD, padBytes: 10 * 1024 * 1024 }))

    const started = performance.now()
    const result = await parse(save)
    const elapsed = performance.now() - started

    expect(result.owned).toHaveLength(3)
    // Skipping is offset arithmetic; the only cost here should be the inflate itself.
    expect(elapsed).toBeLessThan(1000)
  })
})
