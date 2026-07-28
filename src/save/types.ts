import type { GenderCode } from '../engine/types.ts'

/**
 * Every way an import can fail, in the vocabulary the import panel switches on (exhaustively, with
 * a never-bound default). Codes are stable UI contract — the panel maps each to plain-language copy.
 *
 * - `too-large` / `not-a-save` / `unknown-magic` / `xbox-save`: rejected before or during the wrapper.
 * - `truncated`: the file was cut short, or a compressed stream refused to decode.
 * - `wrong-file`: a valid Palworld GVAS save that isn't `Level.sav` (no `worldSaveData` in it).
 * - `skip-drift`: the property walk lost sync — our byte-format assumptions are wrong for this save.
 *   Never a user error; it means the parser needs fixing, so the detail carries the property path.
 * - `internal`: an unexpected throw. Only the worker's catch-all and the ooz-wasm load path produce
 *   it; it exists so an unforeseen `TypeError` can't masquerade as a diagnosis of the user's file.
 */
export type ParseErrorCode =
  | 'xbox-save'
  | 'not-a-save'
  | 'wrong-file'
  | 'unknown-magic'
  | 'truncated'
  | 'skip-drift'
  | 'too-large'
  | 'internal'

/** `detail` is the human-readable half: it names the offset/path, so a bug report is actionable. */
export class ParseError extends Error {
  code: ParseErrorCode

  constructor(code: ParseErrorCode, detail: string) {
    super(detail)
    this.name = 'ParseError'
    this.code = code
  }
}

/** IVs, 0-100 each. */
export interface Talents {
  hp: number
  shot: number
  defense: number
}

/**
 * One pal in the save. `talents` is null when the save carried no `Talent_*` field at all: absent
 * fields are game defaults rather than errors (`PC README.md:25`), and a null says "unknown" where
 * a zero would silently claim a 0-IV pal.
 */
export interface OwnedPal {
  speciesIndex: number
  gender: GenderCode | null
  passives: string[]
  talents: Talents | null
}

/**
 * `palCount` counts pal rows found in the save, `owned` only those whose species we could resolve —
 * the difference is `unknownPals`, spread over the `unknownSpecies` (raw `CharacterID`s, deduped
 * and sorted) that produced them, which is expected to be non-empty for bosses, humans and pals
 * newer than our dataset.
 *
 * Every other row in the character map is one of two different things, and the summary can only be
 * honest if they stay apart: `playerRows` are rows flagged `IsPlayer` — the humans, one per member
 * of a guild world — while `unreadableRows` are rows we could not interpret at all (no
 * `CharacterID`, or no `RawData` to read one from), which on a healthy save is zero.
 * `palCount + playerRows + unreadableRows` is every row the map declared.
 *
 * `warnings` is the parser's channel for "this worked, but you should know", each a finished
 * sentence for the panel to show. `unknownSpecies`, `unknownPals` and `oddTypes` are the same facts
 * structured: the prose is a convenience, the fields are what anything but a `<p>` should read.
 */
export interface ImportResult {
  owned: OwnedPal[]
  unknownSpecies: string[]
  /** Pal rows dropped because their species is not in this build's paldex. */
  unknownPals: number
  /** `Talent_HP (FloatProperty)`-style names of fields present in a shape we don't read. */
  oddTypes: string[]
  playerRows: number
  unreadableRows: number
  palCount: number
  warnings: string[]
}

/**
 * `buffer` is transferred, not copied, so the caller's view is neutered once this is posted.
 * `byIdLower` arrives as entry pairs rather than a `Map` purely to keep the message plain JSON —
 * the dataset lives on the main thread and the worker never loads it.
 */
export interface SaveImportRequest {
  requestId: number
  buffer: ArrayBuffer
  byIdLower: Array<[string, number]>
}

export type SaveImportResponse =
  | { ok: true; requestId: number; result: ImportResult }
  | { ok: false; requestId: number; code: ParseErrorCode; detail: string }
