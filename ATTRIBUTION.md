# Attribution

palmatch is a fan-made tool built on top of other people's data, research, and code. This file
credits all of it.

## palcalc

Pal roster, stats, and breeding data are pipelined at build time from
[palcalc](https://github.com/tylercamp/palcalc) (by tylercamp), which datamines the numbers
straight out of the game. palcalc is MIT-licensed; our data pipeline and its output remain
compatible with that license even though the rest of this repo is now GPL-3.0-or-later.

## palpedia.net Discord researchers

The mutation-odds model is not datamined — it's community research reverse-engineered by testing
in-game, credited to researchers in the palpedia.net Discord: **Dinosaur**, **Kernist**,
**DirectingRage**, **Despair**, and others who shared findings there. Treat these odds as
best-effort community estimates, not official numbers.

## ooz-wasm / powzix/ooz

Palworld saves compress most of their data with **Oodle**, a proprietary compression format
licensed by RAD Game Tools. There's no official, redistributable decoder for it. The
[powzix/ooz](https://github.com/powzix/ooz) project reverse-engineered an Oodle-compatible
decompressor from scratch, and [ooz-wasm](https://github.com/SnosMe/ooz-wasm) compiles that work
to WebAssembly so it can run in a browser.

Both powzix/ooz and ooz-wasm are licensed **GPL-3.0-or-later**. GPL is a "copyleft" license: any
work that bundles and distributes GPL-licensed code must itself be distributed under the GPL. Since
palmatch bundles ooz-wasm (loaded lazily, only when a save actually needs Oodle decompression),
the whole repository is GPL-3.0-or-later — see [LICENSE](./LICENSE). This is the same accommodation
other community Palworld tools (e.g. palcalc's bundled `libooz.dll`, palworld.tf) already make;
palmatch just states it plainly instead of leaving the licensing implicit.

## pako

[pako](https://github.com/nodeca/pako) is a JavaScript port of zlib used to inflate the `PlZ1`/
`PlZ2` (non-Oodle) save compression paths. MIT-licensed.

## Game data & assets

Palworld, all game data, and all game art belong to Pocketpair, Inc. palmatch is an unofficial fan
tool and is not affiliated with or endorsed by Pocketpair.
