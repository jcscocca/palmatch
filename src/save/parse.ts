import { readCharacterFields, resolveSpecies } from './character.ts'
import { Cursor, endValue, openCharacterMap, readEntryRawData, readGvasHeader } from './gvas.ts'
import type { OozDecompress } from './ooz.ts'
import { ParseError, type ImportResult, type OwnedPal } from './types.ts'
import { decompressSave } from './wrapper.ts'

/**
 * Ceiling on the file we accept at all, checked before a byte is touched. A `Level.sav` from a
 * heavily-played multiplayer world runs to a few hundred MB decompressed but far less on disk, so
 * anything past this is not a save we could hold in a tab even if it were one.
 */
export const MAX_SAVE_BYTES = 500 * 1024 * 1024

/**
 * `Level.sav` bytes -> the pals in it. Async because the Oodle decompressor is a lazily-imported
 * wasm module; `loadOozFn` is injectable so tests can exercise that path without it.
 *
 * `byIdLower` maps lowercased dataset ids to indices — species resolution is the caller's dataset,
 * not ours, so nothing here loads or knows about the Paldex.
 */
export async function parseSave(
  buffer: ArrayBuffer,
  byIdLower: Map<string, number>,
  loadOozFn?: () => Promise<OozDecompress>,
): Promise<ImportResult> {
  if (buffer.byteLength > MAX_SAVE_BYTES) {
    throw new ParseError(
      'too-large',
      `the file is ${Math.round(buffer.byteLength / 1024 / 1024)} MB, past the ${MAX_SAVE_BYTES / 1024 / 1024} MB limit`,
    )
  }

  const gvas = await decompressSave(buffer, loadOozFn)
  const cur = new Cursor(gvas)
  const header = readGvasHeader(cur)
  const map = openCharacterMap(cur, header.saveGameClassName)

  const owned: OwnedPal[] = []
  const unknown = new Set<string>()
  let playerCount = 0
  let palCount = 0

  for (let i = 0; i < map.count; i++) {
    // An entry whose value list holds no RawData is a row we can't interpret at all — it counts as
    // neither a pal nor a player. That only happens on a damaged file, and losing one row is a
    // better answer there than refusing the whole save.
    const raw = readEntryRawData(cur, i)
    if (raw === null) continue
    const fields = readCharacterFields(raw, `CharacterSaveParameterMap[${i}].Value.RawData`)

    // Players share the map with their pals. They are marked `IsPlayer`, and (per PLM's survey of a
    // real world) carry no `CharacterID` at all — treat either as "not a pal" so the counts add up.
    const id = fields.characterId
    if (fields.isPlayer || id === null || id.toLowerCase() === 'none') {
      playerCount++
      continue
    }
    palCount++

    const speciesIndex = resolveSpecies(id, byIdLower)
    if (speciesIndex === null) {
      unknown.add(id)
      continue
    }
    owned.push({
      speciesIndex,
      gender: fields.gender,
      passives: fields.passives,
      talents: fields.talents,
    })
  }

  // End-to-end check on the whole walk: every entry we just read has to add up to the size the map
  // declared. Anything else means a skip landed in the wrong place and the pals above are fiction.
  cur.path = 'worldSaveData'
  endValue(cur, map.tag)

  return {
    owned,
    unknownSpecies: [...unknown].sort(),
    playerCount,
    palCount,
  }
}
