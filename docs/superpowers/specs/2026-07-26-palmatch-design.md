# palmatch — Design

**Date:** 2026-07-26
**Status:** Approved pending user review
**One-liner:** A fast, dark, console-styled Palworld breeding workbench for me and my server mates — answers "what do these two make?", "how do I get this pal?", and everything in between, without palpedia's clutter.

## Goals

1. **Parents → offspring**: pick two pals, see the child instantly — plus the mutated-egg pool and passive-inheritance odds.
2. **Target → parents**: pick a desired pal, see every parent combination that produces it (including via mutation), with unique/same-species/gender-locked combos badged.
3. **Chains**: given starting pals and a target, find step-by-step breeding paths (BFS, capped depth).
4. Shareable: any workbench state is a URL friends can open.
5. Trustworthy: data derived mechanically from datamined ground truth; estimated models labeled as such.

## Non-goals (v1)

- No owned-pals checklist / persistence (explicitly cut during brainstorming).
- No accounts, no backend, no server-side anything.
- No PWA/offline support (revisit later).
- No SEO prerendering — hash-route URLs shared in Discord are sufficient.

## Audience & deployment

Jacob + friends/server mates. Static site on GitHub Pages, deployed by GitHub Action. Desktop-first, fully usable on mobile (slots stack vertically, tabs scroll horizontally).

## Research findings (2026-07-26)

- **Game state:** Palworld 1.0 (2026-07-10 full release; 287 Paldex pals; Mutation is an official 1.0 mechanic; level cap 80).
- **Primary data source: [tylercamp/palcalc](https://github.com/tylercamp/palcalc)** — MIT, actively maintained (pushed 2026-07-25), extracts directly from the game's Unreal data tables via CUE4Parse.
  - `PalCalc.Model/db.json` (~1.6MB): per-pal `BreedingPower` (game field `CombiRank`), `BreedingPowerPriority` (`CombiDuplicatePriority`), `BreedingGenderProbability`, `GuaranteedPassivesInternalIds`, full `PassiveSkills` table with `RandomInheritanceAllowed`/`RandomInheritanceWeight`.
  - `PalCalc.Model/breeding.json` (~8.9MB): **precomputed 44,851-entry parent-pair → child table**, unique combos (game table `DT_PalCombiUnique`) and the single gender-locked pair already resolved. 299 breedable entries (variants counted separately from the 287 Paldex numbers).
  - `PalCalc.UI/Resources/Pals/`: **299 sprites — exactly one per breedable entry.** Same repo as data ⇒ no drift.
- **Do NOT reimplement the game's child-selection formula.** The naive formula (`floor((rankA+rankB+1)/2)` → nearest eligible rank, tiebreak higher priority) is correct in shape, but the candidate-eligibility rules are subtle; a brute-force reimplementation attempt mismatched ~14,700 of 44,849 pairs. Consume the precomputed table.
- **Mutations** (official 1.0 mechanic): eggs have ~1% chance (≈2% Vegetable Cake, ≈3% Extravagant Vegetable Cake; community-measured, Pocketpair never published odds) to be a Mutated Egg: min ~90 IVs, guaranteed Alpha, 2★ condensation, bonus passive; species can differ from the normal result and is always *stronger* (lower CombiRank) than the parents. **No authoritative model exists.** The only calibrated model is palpedia.net's community one; its exact algorithm was extracted from their JS bundle (see Algorithms) and will be credited and labeled "community-estimated".
- **Passives/IVs:** child inherits 1/2/3/4 passives from the parents' pool at 40/30/20/10 weights; per-skill eligibility flags in `db.json`; IVs inherit 30% father / 30% mother / 40% random per stat. palcalc's MIT C# implements the full probability math — port, don't invent.
- **Stale sources to avoid:** mlg404/palworld-paldex-api, blaynem/paldex, PalworldDataTools/* (all pre-1.0).
- **Palpedia internals** (for reference): Next.js site, entire dataset bundled client-side in JS chunks; no API. Its unique-combo data mirrors `DT_PalCombiUnique` (`{parentA, parentB, childId}` by internal tribe name).

## UX design

**Aesthetic — "Console-lite"** (chosen from 4 directions, then 2 intensities): near-black surfaces, monospace type, mint accent, hard 2px borders, offset box shadows, square corners. Modern tool first, pixel-era flavor second. Design tokens:

```css
--bg: #0f1115;  --surface: #161920;  --surface-alt: #1a1d24;
--border: #2a2f3a;  --text: #e8eaf0;  --text-dim: #6b7385;  --text-faint: #4a5264;
--accent: #5ee9b5;  --accent-bg: #12241c;
/* borders 2px solid; shadows 3px 3px 0 #000; border-radius 0 */
```

**Interaction model — the Workbench** (chosen over command-palette-first and tabs-per-tool): one screen, three slots — **Parent A × Parent B → Target**. The fill state IS the query; no mode switching:

| Slots filled | Result tabs |
|---|---|
| A + B | **CHILD** (offspring + rank math), **MUTATIONS** (mutated-egg pool w/ weights + disclaimer), **PASSIVE ODDS**, **ALL A-COMBOS** |
| Target only | **PARENT COMBOS** (all pairs, filter by type/name, badges: unique / same-species / ♀♂-locked), **VIA MUTATION** (pairs whose mutation pool includes target) |
| A (±B) + Target | **CHAINS** (step-by-step breeding paths, depth cap adjustable, default 6) |
| A only | **ALL A-COMBOS** (everything A can make, across all partners) |

**Search:** `/` or ⌘K or click an empty slot. Fuzzy name match + paldex number; type filter chips; arrow keys navigate, `1`/`2`/`3` sends the hit to slot A/B/Target. Every pal shown anywhere (result card, combo row, chain step) has one-click/keystroke actions: *set as parent* / *set as target* — the browse loop never requires re-searching.

**Passive odds:** each parent slot expands to optionally declare its passives; the odds tab computes P(child ends with the desired passive set) via the 40/30/20/10 model + cake notes. Presented as estimates.

**Shareability:** entire workbench state in the URL hash — `#/b/foxparks+bristla`, `#/t/grizzbolt`, `#/c/foxparks+bristla>grizzbolt` (slots + active tab). Bidirectional sync with the store.

**Images — HARD REQUIREMENT:** real pal sprites only, sourced from palcalc. **No emoji stand-ins under any circumstances.** Build fails if any pal lacks a sprite; runtime load failure renders a neutral silhouette tile.

## Data pipeline

`npm run data:refresh` (script in `scripts/`):

1. **Fetch** from tylercamp/palcalc at a **pinned commit** (stored in `data-manifest.json`; bumping the pin is a deliberate, reviewed change): `db.json`, `breeding.json`, `Resources/Pals/*.png`.
2. **Transform** → build artifacts consumed by the app:
   - `pals.json` (~80KB): id, name, paldex #, types, breedingPower, tiebreakPriority, genderProbability, guaranteedPassives, spriteRef.
   - `matrix.bin`: 299×299 Uint16 child-index matrix flattened from breeding.json (~180KB raw, ~60KB gzipped). Ground truth verbatim; never recomputed.
   - `combos.json`: unique combos + gender-locked pair (badging only — results already in matrix).
   - `passives.json`: skill list + inheritance flags/weights.
   - `mutation.json`: model constants tagged `"source": "community-estimated (palpedia.net Discord research)"` — UI disclaimer is data-driven.
   - Sprites → `public/sprites/{id}.webp` (~10KB each, ~3MB total, lazy-loaded).
3. **Validate — build fails on:** missing sprite for any pal; holes in the matrix; golden-check regressions (Relaxaurus+Sparkit→Relaxaurus Lux; Katress♀×Wixen♂→Katress Ignis and Katress♂×Wixen♀→Wixen Noct; same-species→same-species for 20 sampled species; entry count = 299).
4. **Manifest:** records palcalc commit, game version, refresh date; surfaced in the app footer.

**Refresh cadence:** manual after game patches + optional weekly GitHub Action that diffs palcalc and opens a PR (data updates always arrive as reviewable diffs).

**Attribution (footer):** palcalc (MIT) for data/sprites; palpedia.net Discord community (Dinosaur, Kernist, DirectingRage, Despair, et al.) for mutation research; "Unofficial fan tool. Not affiliated with Pocketpair. Palworld and all game assets © Pocketpair, Inc."

## Algorithms

- **Child lookup:** `matrix[indexOf(a) * 299 + indexOf(b)]` (matrix is symmetric except the gender-locked pair, stored directionally with the badge data).
- **Find parents:** scan matrix row/column for target index; group + de-dupe unordered pairs; annotate with badges from `combos.json`.
- **Chains:** BFS in a web worker. State = set of obtainable species (starters ∪ bred children); expand by breeding any two obtainable; depth cap default 6 (UI-adjustable); return shortest paths, tie-break by fewest distinct intermediate species. Explicit "no path within N breeds" on exhaustion.
- **Mutation pool** (ported from palpedia's community model; constants in `mutation.json`):
  - `r5(x) = Math.round(2x + 0.5) >> 1` (half-rounding, matches their bundle)
  - `lo = min(rankA, rankB)`; `h = r5(lo × 0.5) + r5(|rankA − rankB| × 0.4)`; `p = max(1, r5(lo × 0.1))`
  - Candidate target ranks: `max(1, h+1) … h+p`; each maps (binary search, tiebreak higher duplicate-priority) onto eligible pals — excluding bosses, predators, `ignoreCombi` entries; occurrence counts become relative weights.
  - Egg mutation chance: 1% base / ~2% Vegetable Cake / ~3% Extravagant Vegetable Cake (displayed with "community-measured" caveat).
- **Reverse mutation:** enumerate pairs whose mutation pool contains the target (precomputed lazily per target in the worker; mutation only moves to *stronger* (lower-rank) pals, which prunes the search).
- **Passive odds:** port palcalc's model — inherit k∈{1,2,3,4} passives from parents' union at weights 40/30/20/10, plus random-fill rules gated by `RandomInheritanceAllowed`/`Weight`; compute P(desired ⊆ child passives). Cake effects noted informationally. IV note: 30/30/40 per-stat display, no calculator in v1.

## Architecture

**Stack:** Vite + React + TypeScript. Static build, hash routing. GitHub Pages via GitHub Action. No backend.

```
src/
  engine/     # pure TS, zero React: breed(), findParents(), findChains() [worker],
              # mutationPool(), reverseMutation(), passiveOdds()
  data/       # typed loaders: pals map, matrix ArrayBuffer, combos, passives, mutation constants
  state/      # Zustand store: 3 slots + active tab; bidirectional URL-hash sync
  ui/         # Workbench, Slot, SearchPalette, ResultTabs,
              # ChildCard, ComboTable, ChainView, MutationPanel, OddsPanel; PalTile primitive
scripts/      # data pipeline (fetch/transform/validate)
public/
  data/       # pipeline artifacts
  sprites/    # 299 webp sprites
docs/superpowers/specs/
```

Styling: plain CSS custom properties (tokens above), monospace stack (`ui-monospace, 'SF Mono', Menlo, monospace`), no component library.

## Error handling

- Data fetch failure → full-screen retry state (no partial UI).
- Unknown pal id in shared URL → clear that slot, show inline notice.
- Chain search exhausts depth cap → explicit "no path within N breeds — raise depth?" message; never a silent empty state.
- Sprite load failure → neutral silhouette tile (never emoji).
- Worker unresponsive (>5s) → cancel + surface error with retry.

## Testing

- **Engine golden tests (vitest), the priority:** fixtures sampled from `breeding.json` at pipeline time (500 seeded-random pairs + every unique combo + the gender-locked pair + same-species checks). Engine verified against ground truth on every CI run.
- Pipeline validation gates double as data tests (run in CI on data PRs).
- Light component tests: search → slot → result flow; URL round-trip (state → hash → state).
- No e2e suite in v1.

## Decisions log

| Decision | Chosen | Rejected |
|---|---|---|
| Audience | Me + friends, static shared deploy | Personal-only; public/SEO site |
| Features | Chains, mutations, passive odds | Owned-pals checklist (cut) |
| Aesthetic | Console-lite (C palette × D retro, low intensity) | Field guide; playful Pokédex; full handheld |
| Interaction | Unified workbench + integrated search | Command-palette-first; tabs-per-tool |
| Data | palcalc precomputed table, pinned + validated | Reimplementing game formula; scraping palpedia/wikis; stale APIs |
| Architecture | Static Vite SPA, engine/UI split, worker BFS | Next.js prerender; any backend |
| Name | **palmatch** | palbench, hatchery, eggmath, palforge |
