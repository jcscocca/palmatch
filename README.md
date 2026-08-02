# palmatch

A Palworld breeding workbench. Pick two parents to see what they hatch, pick a target to see every
pair that makes it, plan multi-step breeding chains toward a pal you don't have parents for yet,
check mutation odds for a pairing, and estimate the odds a child inherits the passive skills you
want.

[Open the deployed app](https://jcscocca.github.io/palmatch/)

<!-- screenshot: docs/screenshot.png — workbench in pair mode, child card + mutation panel visible -->

Everything runs client-side against data pipelined from [palcalc](https://github.com/tylercamp/palcalc)
(datamined game data) at build time — no backend, no game files required to run it.

## Quickstart

```sh
npm i
npm run dev
```

Other scripts: `npm run build` (typecheck + production build to `dist/`), `npm test` (vitest),
`npm run lint` (oxlint), `npm run preview` (serve the production build locally).

## Data refresh

The breeding matrix, pal roster, sprites, and element icons are generated from a pinned palcalc
commit and a small palpedia.net snapshot (types + unique-combo badges), not fetched at runtime.
To pick up a game patch:

```sh
npm run data:refresh
```

This fetches palcalc's `db.json`/`breeding.json`/sprites into `.cache/` (skipping anything already
there), extracts the palpedia bundle, transforms everything into `public/data/*` + `public/sprites/*`
+ `public/elements/*` + `src/engine/fixtures/goldens.json`, and validates the result before writing
anything (pal count, sprite coverage, matrix completeness, golden breeding pairs).

**If you bump `palcalcCommit` in `data-manifest.json` to point at a newer patch, run `rm -rf .cache`
first.** The cache is keyed by file presence only, not by commit — `npm run data:refresh` against a
stale `.cache/` will happily keep serving the old commit's `db.json`/`breeding.json`/sprites instead
of fetching the new ones.

## MY PALS (save import)

MY PALS reads a Palworld save and turns it into an owned-species list the workbench and breeding
planner use. Parsing runs in a Web Worker.

**Pick the folder if you can.** On Chromium, FIND MY SAVE FOLDER walks the folder you pick (up to
two levels deep) for `Level.sav` and also collects the pal stores that live *outside* it — see
below. Drag-and-drop and BROWSE… work everywhere and accept several files at once, so you can
shift-select `Level.sav` together with the `_dps.sav` files. A lone `Level.sav` still imports fine;
the panel just says that's all it read.

**The save is never uploaded anywhere — palmatch has no server, it's a static site, and the file
never leaves the browser tab.** The owned list is kept in `localStorage`
(`palmatch.owned.v1`), not in the URL.

**Where the save lives**

- Windows: `%LOCALAPPDATA%\Pal\Saved\SaveGames\<steam-id>\<world-id>\Level.sav`
- Dedicated server: `Pal/Saved/SaveGames/0/<world-id>/Level.sav`
- Steam Deck / Linux (Proton): `~/.steam/steam/steamapps/compatdata/1623730/pfx/drive_c/users/steamuser/AppData/Local/Pal/Saved/SaveGames/`

**Pals that aren't in `Level.sav`**

`Level.sav` holds parties, palboxes and base pals. Palworld keeps two more pal stores in separate
files, and palmatch reads both when it can reach them:

| file | where | what's in it |
| --- | --- | --- |
| `<player-id>_dps.sav` | `<world-id>/Players/` — one per player | Dimensional Pal Storage, ~9,600 slots. Where duplicate catches, breeding leftovers and condensation stock get dumped. |
| `GlobalPalStorage.sav` | `SaveGames/<user-id>/` — *beside* the world folders, one level above | The account-wide Global Palbox. Low volume, filled one pal at a time, but often prized specimens. |

Both files only exist once you've used the feature, so **most saves have neither and that is
normal** — nothing is reported when a walked folder holds none. Because `GlobalPalStorage.sav` sits
above the world folder, only FIND MY SAVE FOLDER (pointed at `SaveGames` or your user-id folder)
reaches it. The other `.sav` files in `Players/` are player profiles and hold no pals.

The summary line says what was read — `from Level.sav · 2 storage files` when there were any. A
storage file that won't parse is reported as a warning and the rest of the import still lands; only
a broken `Level.sav` fails the import outright.

For each species, the importer keeps a representative breeding portfolio of up to five individual
Pals. It favors clean one-passive males and females, preserves distinct Rainbow-ranked passives,
then fills the remaining slots with the strongest positive-passive and IV candidates. Re-import an
existing save to rebuild its saved portfolio with this selection logic.

## PASSIVE PLAN

Choose two parent species, then open PASSIVE PLAN to select an owned copy or enter each parent's
passives and sex manually. Pick a combat, work, or mount role for community-curated beginner
suggestions; the rank badges still expose the underlying game-data rank so you can make your own
choice. The planner recommends direct, cleanup, and merge steps, with exact-set odds plus average
and 90th-percentile egg estimates. These are probability estimates—not guarantees—and the plan
optimizes passive inheritance before you choose a final target-species route.

**Share links & `.palmatch.json`**

SHARE copies a `#/own/<blob>` link — deflate + base64url of species indices, counts, and each
species' male/female split, nothing else (no passives, no IVs, no pal names or nicknames, no player
names or IDs). DOWNLOAD writes `my-pals.palmatch.json` with the same
payload, droppable back into the panel on any machine. Opening a shared link asks for confirmation
before it replaces the recipient's list, and any species the receiving build doesn't recognize are
dropped, with a count shown.

**Xbox / Game Pass saves aren't supported.** They're a different (`CNK0`) container format and are
rejected with a clear message. Only Steam/PC saves, and dedicated server saves, can be read.

**Troubleshooting**

| what you see | what it means | what to do |
| --- | --- | --- |
| "this is an Xbox/Game Pass save — palmatch can only read Steam/PC saves" | wrong container format | use a Steam/PC (or dedicated server) save |
| "that doesn't look like a Palworld save — `<file>` isn't one" | not a Palworld save at all | pick the right file |
| "that's `<file>` — you want Level.sav, the big one in your world folder" | wrong file from the world folder | drop `Level.sav` |
| "`<file>` is bigger than the 500 MB palmatch can hold — deleting unused bases and pals in-game shrinks Level.sav" | over the 500 MB cap | shrink the save in-game, retry |
| "that save is corrupt or was cut short — try a fresh copy, taken while the game is closed" | truncated file or bad compressed stream | copy it again with the game closed; if it recurs, file an issue with the detail line shown |
| "palmatch lost its place reading that save — its format isn't what this version expects" | parser's byte-format assumptions don't hold here | file an issue with the detail line shown |
| "palmatch does not recognise this save format — the game may have updated it" | unknown magic bytes | file an issue with the detail line shown |
| "something went wrong reading that file" | unexpected internal error | file an issue with the detail line shown |
| "that import did not finish within 60 seconds — try again, or with a smaller world" | worker timeout | retry; if it recurs, file an issue with the detail line shown |
| "that shared list is damaged or too old to read — ask for a fresh one" | share link/file failed to decode | ask the sender for a fresh one |
| "no Level.sav in that folder — pick the SaveGames folder, or a world folder inside it" | nothing found in the 2-level walk | pick a folder closer to `Level.sav` |
| "couldn't read `<file>`, so any pals kept in it are not counted: …" | a `_dps.sav` / `GlobalPalStorage.sav` failed to parse; the `Level.sav` import still succeeded | copy the folder again with the game closed; if it recurs, file an issue with the detail line shown |
| a pal you own is missing from the list | it's in Dimensional Pal Storage or the Global Palbox, and only `Level.sav` was read | use FIND MY SAVE FOLDER, or select the `_dps.sav` files alongside `Level.sav` |

## Deploy

Pushing to `main` builds and deploys the site via `.github/workflows/deploy.yml` (GitHub Pages,
Actions-based deployment). This needs Pages enabled on the repo with **Source: GitHub Actions**
(Settings → Pages) — no `gh-pages` branch or manual publish step required.

## Attribution

Data & sprites: palcalc (MIT) · Mutation model: community research by the palpedia.net Discord
(Dinosaur, Kernist, DirectingRage, Despair, et al.) · Unofficial fan tool, not affiliated with
Pocketpair. Palworld and all game assets © Pocketpair, Inc.

## License

Code is **GPL-3.0-or-later** — see [LICENSE](./LICENSE), © 2026 Jacob Scocca. This repo relicensed
from MIT because it bundles `ooz-wasm`, a GPL-3.0 WebAssembly build of the reverse-engineered
Oodle decompressor needed to read save files; GPL's copyleft terms require anything that bundles
it to also be GPL. Full provenance and credits (palcalc, palpedia.net Discord researchers,
ooz-wasm/powzix-ooz, pako) live in [ATTRIBUTION.md](./ATTRIBUTION.md).

Game data and art (pal stats, breeding data, sprites, element icons) belong to Pocketpair, Inc. and
are used here datamined/unofficially for a fan tool; palcalc's own data pipeline and outputs are
MIT-licensed. The mutation model is community-estimated research, not datamined or official.
