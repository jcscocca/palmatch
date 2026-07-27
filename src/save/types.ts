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
 * the difference is `unknownSpecies` (raw `CharacterID`s, deduped and sorted), which is expected to
 * be non-empty for bosses, humans and pals newer than our dataset.
 */
export interface ImportResult {
  owned: OwnedPal[]
  unknownSpecies: string[]
  playerCount: number
  palCount: number
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
