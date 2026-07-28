# palmatch — Save Import (Owned Pals) Design

**Date:** 2026-07-27
**Status:** Approved (user: "Approve. Go full swing")
**Extends:** 2026-07-26-palmatch-design.md (v1, shipped)
**One-liner:** Drag your Palworld save into palmatch and every calculator knows which pals you actually own — with a one-click share link so non-technical server mates never touch a save file.

## Goals

1. **Non-tech drag-and-drop**: a random non-technical player imports their save with zero installs, zero command line — drop `Level.sav` on the page (or pick the save folder), done. Fully client-side.
2. **Owned-aware answers**: chains can start from "everything we own"; combo tables can filter/badge to owned pals.
2b. **Every pal store, not just `Level.sav`** (added 2026-07-27): Dimensional Pal Storage (`<world>/Players/<uid>_dps.sav`, ~9,600 slots and the recommended dump for duplicate catches and breeding leftovers) and the account-wide Global Palbox (`SaveGames/<userid>/GlobalPalStorage.sav`) are separate files, so a `Level.sav`-only import undercounts exactly the breeding-heavy player this tool targets. One import reads all of them and merges them into one owned list. Folder-picking becomes the recommended path since it is the only one that reaches the Global Palbox (which sits *above* the world folder); multi-file selection is the fallback where `showDirectoryPicker` doesn't exist. A lone `Level.sav` still works and says so. Byte format in `reference/save-format.md` §4.7.
3. **Zero-step for the group**: one import covers the whole guild (all guild pals live in the host's `Level.sav`); a compact share link hands the owned list to server mates.
4. Privacy: saves never leave the browser; nothing derived from a real save is committed to the repo.

## Non-goals

- Xbox/Game Pass container saves (`CNK0`/WGS format) — detected and declined with a clear message.
- Full save editing, IV-perfect breeding solving over individuals (palcalc's deeper feature), pal *locations* (container cross-referencing) — owned species + individuals' gender/passives/IVs is the v1 extract. Note that skipping container parsing costs the one cross-check palcalc uses to drop `Level.sav` pals with no container slot record; see the dedupe note in `src/save/parse.ts`.
- Auto-refresh/file-watching. Import is a manual, repeatable action.

## Licensing decision (user-approved)

The Oodle (`PlM1`) decompression path requires `ooz-wasm` (GPL-3.0, derived from the reverse-engineered `powzix/ooz`). **palmatch relicenses from MIT to GPL-3.0-or-later** — LICENSE, README, and package.json updated; ATTRIBUTION gains ooz/powzix credit and a plain-language provenance note. This is the honest form of what community tools (palcalc's bundled `libooz.dll`, palworld.tf) already do.

## UX design

- Header gains **`MY PALS`** button (shows owned count once imported, e.g. `MY PALS · 87`).
- Clicking opens the **import panel** (same modal pattern as SearchPalette):
  - Empty state: drag-drop zone ("drop Level.sav here") + "browse…" file picker + (Chromium) "find my save folder" via the File System Access API directory picker; per-OS path hints (`%LOCALAPPDATA%\Pal\Saved\SaveGames\<steam-id>\<world-id>\Level.sav`; server: `Pal/Saved/SaveGames/0/<world-id>/Level.sav`).
  - Parsing state: indeterminate pulse + file-size line ("READING 41 MB — Level.sav") — parsing runs in a dedicated worker; UI never blocks. (Amended during F3: staged progress copy cut — parses complete in seconds and the worker protocol stays terminal-only.)
  - Result state: summary card ("87 species · 214 pals · guild of 4 players"), per-species grid with counts, IMPORT AGAIN / CLEAR / SHARE actions.
  - Error states (each with a distinct, plain-language message): wrong file picked (LevelMeta/Players/local); Xbox `CNK0` container; unknown compression magic (game updated — report it); corrupted/truncated; file absurdly large (>500MB → suggest in-game save cleanup).
- **Share**: `SHARE` produces a link `#/own/<blob>` (deflate+base64url of the compact owned list). Opening such a link on any browser imports the list into localStorage after a confirm ("Load Jacob's guild list — 87 species? Replaces your current list."). Also DOWNLOAD/IMPORT as a small `.palmatch.json` for Discord attachment workflows.
- **Integration points**:
  - CHAINS (target mode): "USE MY PALS" toggle — starters = all owned species (multi-starter strict solver, already supports arbitrary starter sets). Off by default when slots are manually filled.
  - ComboTable (parent-combos / all-a-combos / via-mutation): "owned only" filter chip + a small owned tick on PalTiles (styled tick glyph, not emoji).
  - Empty-workbench hint mentions MY PALS once an owned list exists.
- Aesthetic: Console-lite throughout; no emoji (glyphs ok).

## Technical design

- **Worker** (`save-import.worker.ts`): ArrayBuffer in → `{owned: OwnedPal[], stats} | {error: code}` out. Steps: sniff magic → decompress (`PlZ1/PlZ2` via pako; `PlM1` via lazy-loaded ooz-wasm — the WASM chunk loads only when an Oodle save is dropped) → single-pass GVAS property walk that skips every branch except `.worldSaveData.CharacterSaveParameterMap` → per-entry RawData sub-parse → filter out players/NPCs → `OwnedPal { speciesIndex, gender, passives: string[], talents }`, plus unknown-species pass-through list (future pals: warn, don't crash).
- Byte-level formats per `docs/superpowers/reference/save-format.md` (extracted from palcalc SaveReader + oMaN-Rod/palworld-save-tools; that doc is the porting contract).
- **Owned store slice**: `{ bySpecies: Map<index, {count, individuals}> }`, persisted to localStorage (compact JSON, versioned key `palmatch.owned.v1`). Share blob = species+counts only (individuals stay local; passives lists would bloat links).
- Species mapping: save `CharacterID` → normalize (strip `BOSS_`/`Boss_` prefixes, case-insensitive) → match InternalName; unmatched IDs surface in an import-summary warning line.
- **Testing**: a test-only GVAS fixture *builder* (TS) synthesizes minimal valid saves (zlib paths) — full pipeline unit-tested against synthesized fixtures incl. malformed/truncated cases. The Oodle path is unit-tested for magic detection + wiring with a mocked decompressor; real `PlM1` decompression is verified live at Task-9-equivalent time with a real save supplied by the user (never committed).
- No backend, no telemetry; deploy flow unchanged.

## Risks / accepted trade-offs

- ooz-wasm is unmaintained (2023) — pinned + vendored; if a future Palworld codec change breaks it, the error path says so explicitly ("unknown compression — game updated").
- Memory: decompressed worlds are tens-to-hundreds of MB in the worker for seconds; acceptable on desktop, degraded-but-guarded on mobile (size cap + try/catch OOM messaging).
- GPL relicense is repo-wide and effectively permanent for distributed builds.
