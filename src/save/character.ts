import type { GenderCode } from '../engine/types.ts'
import { Cursor, eachProperty, readStringArray, type PropertyTag } from './gvas.ts'
import type { Talents } from './types.ts'

/**
 * The per-entry `RawData` blob is a second, self-contained property tree (reference §4.2) holding
 * one `SaveParameter` struct — the pal itself. Everything in it is optional: Palworld omits any
 * property sitting at its default, so a missing `Talent_Shot` or `PassiveSkillList` is a default,
 * not a parse failure. Nothing here throws on absence; the only errors that escape come from the
 * byte walker underneath, and those mean our format assumptions are wrong.
 *
 * Reference §8 could not confirm whether `Talent_*` and `Rank` ship as `ByteProperty` or
 * `IntProperty`, so every numeric read branches on the tag type actually present. An assumption
 * would have been invisible: reading a byte with an int reader yields a plausible-looking world of
 * 0-IV pals rather than an error.
 *
 * We read six fields and skip the rest of §4.3 — `Rank`, `OwnerPlayerUId`, `SlotID`, souls, active
 * skills. `OwnedPal` has nowhere to put them, and skipping is type-agnostic, so adding one later
 * costs a `case` here and nothing else.
 */

export interface CharacterFields {
  characterId: string | null
  gender: GenderCode | null
  passives: string[]
  talents: Talents | null
  isPlayer: boolean
}

/** `EPalGenderType::Male` on the wire; absent or `None` means the save isn't telling us. */
function toGender(value: string): GenderCode | null {
  const bare = value.slice(value.lastIndexOf(':') + 1)
  if (bare === 'Male') return 'M'
  if (bare === 'Female') return 'F'
  return null
}

/**
 * A number stored as either a `ByteProperty` (1 byte, only when its enum type is `None`) or an
 * `IntProperty`. Returns null when it is neither, leaving the caller to skip the value untouched.
 */
function readByteOrInt(cur: Cursor, tag: PropertyTag): number | null {
  if (tag.type === 'ByteProperty' && tag.enumType === 'None') return cur.u8()
  if (tag.type === 'IntProperty') return cur.i32()
  return null
}

interface TalentSlots {
  hp: number | null
  shot: number | null
  defense: number | null
}

function readSaveParameter(cur: Cursor, out: CharacterFields, slots: TalentSlots): void {
  eachProperty(cur, (tag) => {
    // Case-insensitive throughout: palcalc reads these with `isCaseSensitive: false`, and the
    // casing of at least `SlotId`/`SlotID` is known to vary between fields.
    const key = tag.name.toLowerCase()
    switch (key) {
      case 'characterid': {
        if (tag.type !== 'NameProperty' && tag.type !== 'StrProperty') return 'skip'
        out.characterId = cur.fstring()
        return 'read'
      }
      case 'gender': {
        if (tag.type !== 'EnumProperty') return 'skip'
        out.gender = toGender(cur.fstring())
        return 'read'
      }
      case 'passiveskilllist': {
        if (tag.type !== 'ArrayProperty') return 'skip'
        if (tag.innerType !== 'NameProperty' && tag.innerType !== 'StrProperty' && tag.innerType !== 'EnumProperty') return 'skip'
        out.passives = readStringArray(cur, tag)
        return 'read'
      }
      case 'isplayer': {
        // The player's own row lives in the same map. BoolProperty keeps its value in the tag
        // extras and declares size 0, so there is nothing left to read here.
        if (tag.type !== 'BoolProperty') return 'skip'
        out.isPlayer = tag.boolValue === true
        return 'read'
      }
      case 'talent_hp':
      case 'talent_shot':
      case 'talent_defense': {
        const value = readByteOrInt(cur, tag)
        if (value === null) return 'skip'
        if (key === 'talent_hp') slots.hp = value
        else if (key === 'talent_shot') slots.shot = value
        else slots.defense = value
        return 'read'
      }
      default:
        return 'skip'
    }
  })
}

/**
 * Reads one pal out of its `RawData` bytes. The 4 unknown bytes, guild GUID and 4 trailing bytes
 * that follow the property tree are ignored — palcalc doesn't even read the last four, so their
 * presence is not something to assert on.
 */
export function readCharacterFields(raw: Uint8Array, path: string): CharacterFields {
  const cur = new Cursor(raw, path)
  const out: CharacterFields = {
    characterId: null,
    gender: null,
    passives: [],
    talents: null,
    isPlayer: false,
  }
  const slots: TalentSlots = { hp: null, shot: null, defense: null }

  eachProperty(cur, (tag) => {
    if (tag.name.toLowerCase() !== 'saveparameter' || tag.type !== 'StructProperty') return 'skip'
    readSaveParameter(cur, out, slots)
    return 'read'
  })

  // All three absent means the save never mentioned IVs, which is a different thing from three
  // zeroes; a partial set means the missing ones really are at their default.
  if (slots.hp !== null || slots.shot !== null || slots.defense !== null) {
    out.talents = { hp: slots.hp ?? 0, shot: slots.shot ?? 0, defense: slots.defense ?? 0 }
  }
  return out
}

/**
 * Non-Paldex `CharacterID` forms, stripped only after an exact match fails — a few pals genuinely
 * are their own `BOSS_`-named catalog entry, so the guard has to come first
 * (`PSP dto/pal.rs:64-78`: `BOSS_SheepBall -> sheepball`, `PREDATOR_Deer -> deer`).
 */
const PREFIXES = ['boss_', 'predator_']
const SUFFIXES = ['_avatar']

/** Dataset index for a save's `CharacterID`, or null when nothing in the Paldex matches. */
export function resolveSpecies(characterId: string, byIdLower: Map<string, number>): number | null {
  const lowered = characterId.toLowerCase()
  const exact = byIdLower.get(lowered)
  if (exact !== undefined) return exact

  let id = lowered
  for (const prefix of PREFIXES) {
    if (id.startsWith(prefix)) {
      id = id.slice(prefix.length)
      break
    }
  }
  for (const suffix of SUFFIXES) {
    if (id.endsWith(suffix)) {
      id = id.slice(0, -suffix.length)
      break
    }
  }
  return id === lowered ? null : (byIdLower.get(id) ?? null)
}
