import { readCharacterFields, readCharacterList, resolveSpecies, type CharacterFields } from './character.ts'
import {
  Cursor,
  closeCharacterMap,
  closeStorageArray,
  openCharacterMap,
  openStorageArray,
  readEntryRawData,
  readGvasHeader,
} from './gvas.ts'
import type { OozDecompress } from './ooz.ts'
import { ParseError, type ImportResult, type ImportSource, type OwnedPal, type StorageInput } from './types.ts'
import { decompressSave } from './wrapper.ts'

/**
 * The orchestrator: wrapper -> GVAS header -> character records -> one `OwnedPal` per row. The byte
 * layout every step of that relies on is `docs/superpowers/reference/save-format.md` (§7 is the
 * checklist this function walks).
 *
 * Two kinds of file hold character records, and they differ only in how the records are *contained*:
 * `Level.sav` keys them into `worldSaveData.CharacterSaveParameterMap`, each behind a `RawData` byte
 * blob, while a pal storage file (`_dps.sav`, `GlobalPalStorage.sav`) lays them flat in a root
 * `SaveParameterArray` with no `RawData` step at all. Wrapper, GVAS header and the `SaveParameter`
 * struct itself are identical, so everything from `CharacterFields` down is shared.
 */

/**
 * Ceiling on the file we accept at all, checked before a byte is touched. A `Level.sav` from a
 * heavily-played multiplayer world runs to a few hundred MB decompressed but far less on disk, so
 * anything past this is not a save we could hold in a tab even if it were one.
 */
export const MAX_SAVE_BYTES = 500 * 1024 * 1024

/**
 * A container of character records, read one at a time. Both containers yield the same
 * `CharacterFields` — only the nesting above it differs — so the loop is written once, in `collect`.
 */
interface RecordSource {
  count: number
  /** `null` for a row we cannot interpret at all, which only happens on a damaged file. */
  read(index: number): CharacterFields | null
  /**
   * Whether a row with no `CharacterID` is an empty slot rather than damage. `Level.sav` only holds
   * pals and players, so a row with neither is broken; a pal storage file is mostly empty by design
   * — its slots are recycled in place and never removed, so a vacant one is the normal state of
   * ~9,550 of a Dimensional Pal Storage's ~9,600 slots.
   */
  vacancyIsNormal: boolean
  /** The end-to-end check: the rows just read have to consume exactly what the container declared. */
  close(): void
}

function levelSource(cur: Cursor, className: string): RecordSource {
  const map = openCharacterMap(cur, className)
  return {
    count: map.count,
    read: (index) => {
      const raw = readEntryRawData(cur, index)
      return raw === null ? null : readCharacterFields(raw, `CharacterSaveParameterMap[${index}].Value.RawData`)
    },
    vacancyIsNormal: false,
    close: () => closeCharacterMap(cur, map),
  }
}

function storageSource(cur: Cursor, className: string): RecordSource {
  const array = openStorageArray(cur, className)
  return {
    count: array.count,
    // Each element is the property list itself — no `RawData` blob to lift out first. It is read to
    // its `None` terminator whether or not it holds a pal, since that is what leaves the cursor on
    // the next element.
    read: (index) => {
      cur.path = `SaveParameterArray[${index}]`
      return readCharacterList(cur)
    },
    vacancyIsNormal: true,
    close: () => closeStorageArray(cur, array),
  }
}

/** Everything a single file contributed, before it is merged with its siblings. */
interface FileTally {
  owned: OwnedPal[]
  unknownSpecies: Set<string>
  oddTypes: Set<string>
  unknownPals: number
  playerRows: number
  unreadableRows: number
  vacantSlots: number
  palCount: number
}

function collect(source: RecordSource, byIdLower: Map<string, number>): FileTally {
  const owned: OwnedPal[] = []
  const unknownSpecies = new Set<string>()
  const oddTypes = new Set<string>()
  let playerRows = 0
  let unreadableRows = 0
  let vacantSlots = 0
  let palCount = 0
  let unknownPals = 0

  for (let i = 0; i < source.count; i++) {
    // A row we can't interpret at all only happens on a damaged file, and losing one row is a
    // better answer there than refusing the whole save — but it is counted, so the row tallies
    // still add up to the container's own count.
    const fields = source.read(i)
    if (fields === null) {
      unreadableRows++
      continue
    }

    for (const type of fields.oddTypes) oddTypes.add(type)

    // Players share `Level.sav` with their pals, one row each — a guild world has several. They are
    // marked `IsPlayer` and (per PLM's survey of a real world) carry no `CharacterID` at all, so
    // the two tests are kept apart: the first is a player, the second is a row we can't read.
    if (fields.isPlayer) {
      playerRows++
      continue
    }
    const id = fields.characterId
    if (id === null || id.toLowerCase() === 'none') {
      // `None` is the save format's own vacancy marker, so in a storage file this row is an empty
      // slot rather than a broken one — counting thousands of those as damage would bury a real
      // problem in noise.
      if (source.vacancyIsNormal) vacantSlots++
      else unreadableRows++
      continue
    }
    palCount++

    const speciesIndex = resolveSpecies(id, byIdLower)
    if (speciesIndex === null) {
      unknownSpecies.add(id)
      unknownPals++
      continue
    }
    owned.push({
      speciesIndex,
      gender: fields.gender,
      passives: fields.passives,
      talents: fields.talents,
    })
  }

  // End-to-end check on the whole walk: every row we just read has to add up to the size the
  // container declared. Anything else means a skip landed in the wrong place and the pals are
  // fiction.
  source.close()
  return { owned, unknownSpecies, oddTypes, unknownPals, playerRows, unreadableRows, vacantSlots, palCount }
}

async function readFile(
  buffer: ArrayBuffer,
  byIdLower: Map<string, number>,
  open: (cur: Cursor, className: string) => RecordSource,
  loadOozFn?: () => Promise<OozDecompress>,
): Promise<FileTally> {
  if (buffer.byteLength > MAX_SAVE_BYTES) {
    throw new ParseError(
      'too-large',
      `the file is ${Math.round(buffer.byteLength / 1024 / 1024)} MB, past the ${MAX_SAVE_BYTES / 1024 / 1024} MB limit`,
    )
  }
  const gvas = await decompressSave(buffer, loadOozFn)
  const cur = new Cursor(gvas)
  const header = readGvasHeader(cur)
  return collect(open(cur, header.saveGameClassName), byIdLower)
}

function toResult(tally: FileTally, sources: ImportSource[], extraWarnings: string[] = []): ImportResult {
  const unknownSpecies = [...tally.unknownSpecies].sort()
  const oddTypes = [...tally.oddTypes].sort()
  return {
    owned: tally.owned,
    sources,
    unknownSpecies,
    unknownPals: tally.unknownPals,
    oddTypes,
    playerRows: tally.playerRows,
    unreadableRows: tally.unreadableRows,
    vacantSlots: tally.vacantSlots,
    palCount: tally.palCount,
    warnings: [...buildWarnings(unknownSpecies, tally.unknownPals, oddTypes), ...extraWarnings],
  }
}

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
  label = 'Level.sav',
): Promise<ImportResult> {
  const tally = await readFile(buffer, byIdLower, levelSource, loadOozFn)
  return toResult(tally, [{ label, kind: 'level', palCount: tally.palCount }])
}

/**
 * The same, for a pal storage file — Dimensional Pal Storage or the Global Palbox. Exported for its
 * own tests; the import path goes through `parseSaveSet`.
 */
export async function parseStorageSave(
  buffer: ArrayBuffer,
  byIdLower: Map<string, number>,
  loadOozFn?: () => Promise<OozDecompress>,
  label = 'storage',
): Promise<ImportResult> {
  const tally = await readFile(buffer, byIdLower, storageSource, loadOozFn)
  return toResult(tally, [{ label, kind: 'storage', palCount: tally.palCount }])
}

/**
 * One `Level.sav` plus any number of pal storage files, merged into a single result.
 *
 * **No pal is counted twice, and nothing here dedupes.** Three things establish that a record lives
 * in exactly one of these files:
 *
 * 1. A storage element carries the whole character record — `SaveParameter` and all — not a
 *    reference to one in `Level.sav`. Storing it in two places would mean storing it twice.
 * 2. `PC PlayersSaveFile.cs:51-52` reads the element's own `SlotID` as "the original loc the pal was
 *    stored before it was moved to DPS" and throws it away. The pal was *moved*; the palbox slot it
 *    names is stale.
 * 3. palcalc reads `Level.sav`, every `_dps.sav` and `GlobalPalStorage.sav` into one pal list with
 *    no dedupe of any kind, treating them as distinct locations.
 *
 * An identity key does exist if this is ever wrong — `InstanceId`, in the `Level.sav` map key and in
 * each storage element — but reading every map key's GUID on a 400 MB save is real cost against a
 * case the format says cannot happen.
 *
 * A storage file that won't parse becomes a warning and nothing else. `_dps.sav` only exists once a
 * player has used the feature, may be mid-write, and is not where the pals a player thinks of as
 * theirs mostly live — losing the whole import over one is the wrong trade. A broken `Level.sav`
 * still throws: without it there is no import at all.
 */
export async function parseSaveSet(
  buffer: ArrayBuffer,
  storage: StorageInput[],
  byIdLower: Map<string, number>,
  loadOozFn?: () => Promise<OozDecompress>,
  label = 'Level.sav',
): Promise<ImportResult> {
  const merged = await readFile(buffer, byIdLower, levelSource, loadOozFn)
  const sources: ImportSource[] = [{ label, kind: 'level', palCount: merged.palCount }]
  const warnings: string[] = []

  for (const file of storage) {
    let tally: FileTally
    try {
      tally = await readFile(file.buffer, byIdLower, storageSource, loadOozFn)
    } catch (cause) {
      warnings.push(
        `couldn't read ${file.label}, so any pals kept in it are not counted: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
      continue
    }
    sources.push({ label: file.label, kind: 'storage', palCount: tally.palCount })
    merge(merged, tally)
  }

  return toResult(merged, sources, warnings)
}

/**
 * Folds one file's tally into the running total. Individuals are pooled rather than capped per file:
 * the 5-per-species cap lives in `foldOwned` (src/state/owned.ts) and runs once, over everything, so
 * a player whose best-passive Lamball sits in Dimensional Pal Storage still sees it.
 */
function merge(into: FileTally, from: FileTally): void {
  into.owned.push(...from.owned)
  for (const id of from.unknownSpecies) into.unknownSpecies.add(id)
  for (const type of from.oddTypes) into.oddTypes.add(type)
  into.unknownPals += from.unknownPals
  into.playerRows += from.playerRows
  into.unreadableRows += from.unreadableRows
  into.vacantSlots += from.vacantSlots
  into.palCount += from.palCount
}

/** Caps the species list so one wildly out-of-date dataset can't produce a wall of text. */
const WARNING_LIST_MAX = 3

function buildWarnings(unknownSpecies: string[], unknownPals: number, oddTypes: string[]): string[] {
  const warnings: string[] = []

  if (unknownSpecies.length > 0) {
    const shown = unknownSpecies.slice(0, WARNING_LIST_MAX).join(', ')
    const rest = unknownSpecies.length - WARNING_LIST_MAX
    warnings.push(
      `left out ${unknownPals} pal${unknownPals === 1 ? '' : 's'} whose species palmatch doesn't know: ${shown}${rest > 0 ? ` and ${rest} more` : ''}`,
    )
  }

  if (oddTypes.length > 0) {
    warnings.push(
      `this save stores ${oddTypes.join(', ')} in a form palmatch doesn't recognise, so those IVs were left blank`,
    )
  }
  return warnings
}
