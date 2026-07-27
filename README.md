# palmatch

A Palworld breeding workbench. Pick two parents to see what they hatch, pick a target to see every
pair that makes it, plan multi-step breeding chains toward a pal you don't have parents for yet,
check mutation odds for a pairing, and estimate the odds a child inherits the passive skills you
want.

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
