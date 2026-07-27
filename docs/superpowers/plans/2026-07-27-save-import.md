# palmatch Save Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** In-browser Palworld save import (drag `Level.sav` → owned-pals list) with share links and owned-aware chains/filters, per spec `docs/superpowers/specs/2026-07-27-save-import-design.md`.

**Byte-format contract:** `docs/superpowers/reference/save-format.md` (READ IT before F2 — every wrapper/GVAS/rawdata claim is cited there; its §8 lists unconfirmed facts the implementation must be defensive about).

**Branch:** `save-import` (off main post-v1). **Tech:** existing stack + `ooz-wasm@2.0.0` (exact pin) + `pako` (new dep, MIT) for inflate.

**Binding decisions (from spec + reference §8):**
- Wrapper length semantics follow palworld-save-tools (PST), not palcalc, inside `CNK0` wrappers — but CNK0 itself → structured `xbox-save` error (out of scope).
- `Talent_*` and `Rank` fields read type-agnostically (accept ByteProperty AND IntProperty; the reference couldn't confirm which ships) — a wrong assumption must degrade to warning, never silent zeros.
- Skip-by-size walking uses the reference §3 table + the §8 runtime self-check: after skipping a property, assert consumed == declared; on mismatch throw `ParseError('skip-drift', path)` — never continue on garbage.
- ooz-wasm loads lazily via dynamic `import()` ONLY when magic is `PlM1` (keeps the GPL wasm out of the initial bundle path; whole repo is GPL now anyway, this is for load performance).
- Nothing derived from a real save is ever committed. Test fixtures are synthesized by our own builder.

---

### Task F1: Relicense + dependencies

**Files:** `LICENSE`, `README.md`, `package.json`, `src/ui/Workbench.tsx` (footer), new `ATTRIBUTION.md`.

- [ ] LICENSE → GPL-3.0-or-later full text, `Copyright (C) 2026 Jacob Scocca`.
- [ ] package.json `"license": "GPL-3.0-or-later"`; `npm i ooz-wasm@2.0.0 pako` + `npm i -D @types/pako`. Verify exact versions land in lockfile.
- [ ] README: license section rewritten (code GPL-3.0-or-later; explain why in one sentence — bundled Oodle decompressor lineage; game data/art © Pocketpair; palcalc data MIT upstream). New ATTRIBUTION.md: palcalc, palpedia Discord researchers, ooz-wasm/powzix-ooz provenance paragraph, pako.
- [ ] Footer adds `GPL-3.0` next to the version manifest linking ATTRIBUTION.md (static link is fine).
- [ ] Spike (throwaway test kept as `src/save/ooz.spike.test.ts`, `describe.skipIf(true)` after verification — a comment explains it ran once): dynamic-import ooz-wasm in vitest, assert `decompress` is a function. Confirms ESM/top-level-await interop with our toolchain BEFORE F2 builds on it. If interop fails → report BLOCKED with the exact error (vite worker + TLA wasm is the risk point).
- [ ] Gates: test/build/lint. Commit: `chore: relicense GPL-3.0, add save-import deps`

### Task F2: Save parser + worker

**Files:** new `src/save/` — `wrapper.ts` (outer .sav header sniff + decompress dispatch), `gvas.ts` (header skip + property walker), `character.ts` (CharacterSaveParameterMap → RawData → fields), `parse.ts` (orchestrating `parseSave(buf): ImportResult`), `types.ts` (`OwnedPal {speciesIndex, gender: 'M'|'F'|null, passives: string[], talents: {hp, shot, defense} | null}`, `ImportResult {owned, unknownSpecies: string[], playerCount, palCount}`, `ParseError` with `code: 'xbox-save'|'not-a-save'|'wrong-file'|'unknown-magic'|'truncated'|'skip-drift'|'too-large'`), `save-import.worker.ts` (transferable ArrayBuffer in; `{ok, result} | {ok:false, code, detail}` out; requestId echo like chains worker), plus `fixtures/builder.ts` (test-only GVAS+wrapper byte writer) and tests per module.

- [ ] Implement per reference doc §1-§4 and the parse checklist §7. Species normalization: strip `BOSS_` prefix case-insensitively, lowercase-match against `ds.byId` keys (reuse the URL codec's lower-lookup approach); `IsPlayer` entries excluded; unknown species collected not fatal.
- [ ] `builder.ts` synthesizes: minimal valid PlZ1 save with N pal entries + 1 player (exercises exclusion), Talent fields as ByteProperty in one fixture and IntProperty in another (both must parse), a `PlZ2` double-deflate fixture, truncated file, wrong-GVAS-class file (LevelMeta), `CNK0`-prefixed file, junk file. Builder is `src/save/fixtures/` test-only (excluded from build via tsconfig if needed).
- [ ] Tests: full pipeline on each fixture (owned counts, genders, passives round-trip); every ParseError code reachable and asserted; skip-drift self-check fires on a corrupted-size fixture; worker test (stubbed self, like chains.worker.test.ts) incl. transferable round trip + error mapping. PlM1: magic-detection test + decompressor invoked with (data, rawSize) via injected mock — real Oodle verified live in F6.
- [ ] Perf guard: walker must not materialize skipped branches (no full-tree object). Fixture with a 10MB dummy skipped ArrayProperty parses in <1s in test.
- [ ] Gates. Commit: `feat: client-side save parser with synthesized fixtures`

### Task F3: Owned store + import panel + share

**Files:** `src/state/owned.ts` (slice + localStorage v1 key + share codec), `src/ui/ImportPanel.tsx`, `src/ui/OwnedSummary.tsx` (species grid w/ counts), Workbench header button, `src/state/owned.test.ts`, `src/ui/ImportPanel.test.tsx`.

- [ ] Store: `{bySpecies: Record<number, {count: number, individuals: OwnedIndividual[]}>, importedAt, sourceLabel}`; actions `setOwned(result)`, `clearOwned()`, `loadShared(blob)`. Persist/hydrate localStorage `palmatch.owned.v1` (JSON; individuals capped at 5 stored examples per species to bound size). NOT in URL hash state (share blob is a separate one-shot route).
- [ ] Share codec: `encodeOwned` → deflate(JSON species+counts) → base64url → `#/own/<blob>`; `decodeOwned` with graceful failure. Route handling: on parse of `#/own/`, show confirm panel (species count + replace warning) → import → canonicalize hash to `#/`. Also export/import `.palmatch.json` file (same payload).
- [ ] ImportPanel per spec UX: dialog (native <dialog> pattern from SearchPalette), drag-drop + file input + (feature-detected) `showDirectoryPicker` flow that locates `Level.sav` in a chosen folder (walk one level: `SaveGames/*/*/Level.sav`), per-OS path hints, parsing progress states driven by worker messages, result summary, error messages per ParseError code (plain language, from spec). 500MB pre-check before reading.
- [ ] MY PALS header button with owned species count; empty state opens panel.
- [ ] Tests: store round-trip + localStorage hydrate; share codec round-trip + tamper; panel: drop synthesized fixture File → summary renders counts; each error code renders its message; share-link confirm flow.
- [ ] Gates. Commit: `feat: owned-pals store, import panel, share links`

### Task F4: Owned-aware integrations

**Files:** `src/ui/panels/ChainView.tsx`, `ComboTable.tsx`, `ResultTabs.tsx`, `PalTile.tsx` (owned tick), `src/ui/panels/*.test.tsx` additions.

- [ ] ChainView: `USE MY PALS` toggle (visible only when owned list non-empty). On: starters = owned species indices (dedup, capped only by reality); manual slot starters merge in; label reflects "N owned pals". Off by default when either parent slot is filled manually. Depth/empty-state messaging unchanged (strict-mode message already explains).
- [ ] ComboTable: `OWNED ONLY` filter chip (rows where all displayed parent cells owned); owned tick glyph (`✓`-style styled span, --accent, aria-label "owned") on PalTile via optional `owned?: boolean` prop — threaded from panels reading the owned store. Tick appears in combo tables and chain steps, NOT in search palette (visual noise).
- [ ] Tests: toggle produces worker request with owned starters; owned-only filter narrows; tick renders exactly for owned indices.
- [ ] Gates. Commit: `feat: owned-aware chains and combo filtering`

### Task F5: Polish + docs

- [ ] **Carried from F2 quality review + F3 report:** split `nonPalRows` → `playerRows` + `unreadableRows` in parse.ts/ImportResult (3 lines; lets the summary say "guild of N players" honestly); add structured `oddTypes: string[]` + `unknownPals: number` to ImportResult (warnings prose stays as convenience); export ONE shared `buildLowerLookup` helper (url.ts, parse tests, worker client, panel all hand-roll it); worker: hoist `requestId = req?.requestId ?? -1` above the try (undefined event.data currently → unhandled rejection); window-level dragover/drop guard that auto-opens the import panel (page-drop currently navigates the tab away); `closeCharacterMap` helper; codeOf/detailOf shared test util; builder mirror-note names its uncovered surface (wrapper+headers).
- [ ] **Spec amendment (decided during F3):** the "decompressing → scanning" progress line is CUT — parses complete in seconds; the indeterminate pulse + "READING N MB" line is the shipped behavior. Terminal-only worker protocol stands.
- [ ] README: MY PALS section (how import works, privacy line — save never leaves the browser; share-link explanation; Xbox limitation; troubleshooting table from ParseError codes).
- [ ] Import-panel a11y pass (labels, focus flow — mirror SearchPalette patterns) + mobile layout (drop zone full-width, hints collapsible).
- [ ] Bundle check: `npm run build` → verify ooz-wasm is a separate lazy chunk not in the entry; note sizes in the task report.
- [ ] Full gates + `npm run data:refresh` idempotence still green. Commit: `chore: save-import polish and docs`

### Task F6: Live verification + merge + deploy (main session)

- [ ] Preview build; walkthrough: import synthesized PlZ1 fixture via drag (works end-to-end in real browser), error paths (junk file, LevelMeta fixture), share-link round trip in a second context, USE MY PALS chain, owned filter, mobile.
- [ ] **Real-save check (needs user):** ask Jacob for a current server `Level.sav` (or any real PC save) at this point — verify PlM1 Oodle path + real-world species coverage + memory behavior. BLOCKING for merge unless user waives.
- [ ] Final fresh-context review (diff main..save-import + both specs).
- [ ] Merge to main, push (auto-deploys), verify live site import with the fixture + real save.

## Self-review notes
- Spec coverage: UX panel/states→F3, parser→F2, license→F1, integrations→F4, docs/privacy→F5, live+deploy→F6. Share codec in F3 matches spec (species+counts only).
- Type consistency: OwnedPal/ImportResult defined once in src/save/types.ts; owned store references them; ParseError codes enumerated once and switched exhaustively in ImportPanel (never-bound default like ResultTabs).
- Riskiest item (ooz-wasm/vite interop) deliberately front-loaded as the F1 spike.
