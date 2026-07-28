import { describe, expect, it } from 'vitest'
import { readCharacterFields, resolveSpecies } from './character.ts'
import { characterRawData, fromHex, toHex } from './fixtures/builder.ts'
import { codeOfSync as codeOf } from './test-utils.ts'

/**
 * A `RawData` blob written out by hand from reference §3.3 and §4.2 — not by our builder. It is the
 * one fixture in the suite that can't cancel out a shared parser/builder mistake: the parser has to
 * read these exact bytes correctly, and the builder has to emit them, or the two disagree here.
 *
 * SheepBall, male, IV 66, not a player. Sizes count the value only; every property's tag extras sit
 * between the size and the value and are excluded from it.
 */
const GOLDEN = `
  0e00000053617665506172616d6574657200                // FString(14) "SaveParameter"
  0f00000053747275637450726f706572747900              // FString(15) "StructProperty"
  ec00000000000000                                    // u64 size = 236, the whole SaveParameter body
  2400000050616c496e646976696475616c4368617261
  6374657253617665506172616d6574657200                // FString(36) "PalIndividualCharacterSaveParameter"
  0000000000000000000000000000000000                  // 16-byte struct GUID, then flag 0 (no extra guid)

    0c000000436861726163746572494400                  // FString(12) "CharacterID"
    0d0000004e616d6550726f706572747900                // FString(13) "NameProperty"
    0e0000000000000000                                // u64 size = 14, then the flag byte size doesn't count
    0a000000536865657042616c6c00                      // value: FString(10) "SheepBall"

    0700000047656e64657200                            // FString(7) "Gender"
    0d000000456e756d50726f706572747900                // FString(13) "EnumProperty"
    1900000000000000                                  // u64 size = 25
    0f0000004550616c47656e646572547970650000          // extras: FString(15) "EPalGenderType" + flag 0
    150000004550616c47656e646572547970653a3a4d616c6500 // value: FString(21) "EPalGenderType::Male"

    0a00000054616c656e745f485000                      // FString(10) "Talent_HP"
    0d0000004279746550726f706572747900                // FString(13) "ByteProperty"
    0100000000000000                                  // u64 size = 1
    050000004e6f6e650000                              // extras: enum type "None" => a 1-byte payload
    42                                                // value: 66

    090000004973506c6179657200                        // FString(9) "IsPlayer"
    0d000000426f6f6c50726f706572747900                // FString(13) "BoolProperty"
    0000000000000000                                  // u64 size = 0 -- the value is in the extras
    0000                                              // extras: value byte 0, then flag 0

    050000004e6f6e6500                                // "None" ends the SaveParameter body
  050000004e6f6e6500                                  // "None" ends the RawData property tree
  00000000                                            // 4 unknown bytes
  d9dadbdcdddedfe0e1e2e3e4e5e6e7e8                    // 16-byte guild GUID
  00000000                                            // 4 trailing bytes
`

describe('readCharacterFields on hand-written bytes', () => {
  it('reads the golden blob field by field', () => {
    const bytes = fromHex(GOLDEN)
    expect(bytes.length).toBe(371)

    const fields = readCharacterFields(bytes, 'golden')
    expect(fields).toEqual({
      characterId: 'SheepBall',
      gender: 'M',
      passives: [],
      talents: { hp: 66, shot: 0, defense: 0 },
      isPlayer: false,
      oddTypes: [],
    })
  })

  it('is byte-identical to what the fixture builder writes', () => {
    const built = characterRawData({ characterId: 'SheepBall', gender: 'Male', talents: { hp: 66 }, isPlayer: false })
    expect(toHex(built)).toBe(toHex(fromHex(GOLDEN)))
  })
})

describe('readCharacterFields', () => {
  it('reads talents stored as ByteProperty', () => {
    const fields = readCharacterFields(characterRawData({ talents: { hp: 80, shot: 100, defense: 42 } }), 'byte')
    expect(fields.talents).toEqual({ hp: 80, shot: 100, defense: 42 })
  })

  it('reads the same talents stored as IntProperty', () => {
    const raw = characterRawData({ talents: { hp: 80, shot: 100, defense: 42 }, talentType: 'int' })
    expect(readCharacterFields(raw, 'int').talents).toEqual({ hp: 80, shot: 100, defense: 42 })
  })

  it('says nothing rather than zero when the save carries no IVs at all', () => {
    expect(readCharacterFields(characterRawData({ talents: null }), 'none').talents).toBeNull()
  })

  it('names the shape it did not understand rather than reading an IV out of it', () => {
    const fields = readCharacterFields(characterRawData({ talents: { hp: 80, shot: 55 }, talentType: 'float' }), 'float')
    expect(fields.talents).toBeNull()
    expect(fields.oddTypes).toEqual(['Talent_HP (FloatProperty)', 'Talent_Shot (FloatProperty)'])
  })

  it('defaults only the IVs that are actually missing', () => {
    expect(readCharacterFields(characterRawData({ talents: { shot: 55 } }), 'partial').talents).toEqual({
      hp: 0,
      shot: 55,
      defense: 0,
    })
  })

  it('maps the gender enum, and absent or None to null', () => {
    const genderOf = (gender: 'Male' | 'Female' | 'None' | null): string | null =>
      readCharacterFields(characterRawData({ gender }), 'gender').gender
    expect(genderOf('Male')).toBe('M')
    expect(genderOf('Female')).toBe('F')
    expect(genderOf('None')).toBeNull()
    expect(genderOf(null)).toBeNull()
  })

  it('round-trips the passive list, empty or not', () => {
    const passives = ['PAL_ALLAttack_up2', 'Legend', 'Swift']
    expect(readCharacterFields(characterRawData({ passives }), 'passives').passives).toEqual(passives)
    expect(readCharacterFields(characterRawData({ passives: [] }), 'passives').passives).toEqual([])
    expect(readCharacterFields(characterRawData({ passives: null }), 'passives').passives).toEqual([])
  })

  it('flags the player row', () => {
    expect(readCharacterFields(characterRawData({ isPlayer: true }), 'player').isPlayer).toBe(true)
    expect(readCharacterFields(characterRawData({ isPlayer: false }), 'pal').isPlayer).toBe(false)
    expect(readCharacterFields(characterRawData({}), 'pal').isPlayer).toBe(false)
  })

  it('leaves CharacterID null on a row that has none, the way the player row looks', () => {
    const fields = readCharacterFields(characterRawData({ characterId: null, gender: null }), 'player')
    expect(fields.characterId).toBeNull()
  })

  it('skips cleanly through an ArrayProperty<StructProperty>, which is not stored bare', () => {
    // `clutter` includes GotStatusPointList, the one array shape that writes a full inner tag
    // before its elements (reference §3.5). Skipping it by size has to cross that tag without
    // knowing it exists; a parser that assumed bare elements would desync and lose Talent_Defense.
    const raw = characterRawData({
      characterId: 'CatMage',
      talents: { hp: 1, shot: 2, defense: 3 },
      clutter: true,
      isPlayer: true,
    })
    // IsPlayer is written after the array AND set to true — the non-default value. A desync that
    // skips past it silently would leave the default false, so this expectation is load-bearing;
    // asserting false here would be indistinguishable from never reading the field at all.
    expect(readCharacterFields(raw, 'status-list')).toEqual({
      characterId: 'CatMage',
      gender: 'F',
      passives: [],
      talents: { hp: 1, shot: 2, defense: 3 },
      isPlayer: true,
      oddTypes: [],
    })
  })

  it('refuses to guess when that array lies about its size', () => {
    const raw = characterRawData({ characterId: 'CatMage', clutter: true, corruptStatusListSize: 12 })
    expect(codeOf(() => readCharacterFields(raw, 'status-list'))).toBe('skip-drift')
  })

  it('reads fields sitting after a UTF-16 nickname and a pile of unread properties', () => {
    const raw = characterRawData({
      characterId: 'CatMage',
      gender: 'Male',
      nickName: 'ふわふわ',
      passives: ['Legend'],
      talents: { hp: 12, shot: 34, defense: 56 },
      isPlayer: false,
      clutter: true,
    })
    expect(readCharacterFields(raw, 'clutter')).toEqual({
      characterId: 'CatMage',
      gender: 'M',
      passives: ['Legend'],
      talents: { hp: 12, shot: 34, defense: 56 },
      isPlayer: false,
      oddTypes: [],
    })
  })
})

describe('resolveSpecies', () => {
  const byIdLower = new Map([
    ['sheepball', 3],
    ['catmage', 7],
    ['deer', 9],
    ['boss_gorilla', 11],
  ])

  it('matches a plain id case-insensitively', () => {
    expect(resolveSpecies('SheepBall', byIdLower)).toBe(3)
    expect(resolveSpecies('CATMAGE', byIdLower)).toBe(7)
  })

  it('strips the BOSS_ and PREDATOR_ prefixes and the _Avatar suffix', () => {
    expect(resolveSpecies('BOSS_SheepBall', byIdLower)).toBe(3)
    expect(resolveSpecies('boss_catmage', byIdLower)).toBe(7)
    expect(resolveSpecies('PREDATOR_Deer', byIdLower)).toBe(9)
    expect(resolveSpecies('CatMage_Avatar', byIdLower)).toBe(7)
  })

  it('prefers an exact match to a stripped one, since some pals are their own BOSS_ entry', () => {
    expect(resolveSpecies('BOSS_Gorilla', byIdLower)).toBe(11)
  })

  it('gives up rather than guessing', () => {
    expect(resolveSpecies('PlayerFemale', byIdLower)).toBeNull()
    expect(resolveSpecies('GYM_ThunderDragonMan', byIdLower)).toBeNull()
    expect(resolveSpecies('', byIdLower)).toBeNull()
  })
})
