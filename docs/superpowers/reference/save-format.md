# Palworld save format — porting reference for a TypeScript parser

Single source of truth for a minimal `Level.sav` → `OwnedPal[]` parser. Every claim below is
tied to an upstream file. **Read §7 before writing code.**

## Pinned sources

| Tag | Repo / ref | Notes |
|---|---|---|
| **PC** | `tylercamp/palcalc` @ `be2ec7a95c521dea6591469c051e7cb0f6658065`, paths relative to `PalCalc.SaveReader/` | C#, skip-heavy visitor reader |
| **PST** | `oMaN-Rod/palworld-save-tools` @ `main` (HEAD `790e0bcf` 2026-07-12), paths relative to `palworld_save_tools/` | Python, maintained fork of `cheahjs/palworld-save-tools`; PC is a port of it |
| **PSP** | `oMaN-Rod/palworld-save-pal` @ `main` | Rust; same maintainer as PST, richer domain model |
| **PLM** | `djg2111/palarium` @ `main`, `docs/save-format.md` | Third-party JS/TS implementation. **Corroborating only** — used where PC/PST agree with it, flagged where it conflicts. |

All integers are **little-endian** unless stated.

---

## 1. Outer `.sav` wrapper

`PST compressor/__init__.py:14-42` (`_parse_sav_header`) is the authoritative layout:

```
off  size  field
0    4     u32  uncompressedLen   (length of the FINAL GVAS blob)
4    4     u32  compressedLen
8    3     ascii magic            "PlZ" | "PlM" | "CNK"
11   1     u8   saveType          0x30 '0' | 0x31 '1' | 0x32 '2'
12   ...        payload
```

`PST compressor/enums.py:4-17` names them: `CNK = 0x30`, `PLM = 0x31` (Oodle), `PLZ = 0x32`
(zlib). Note this enum conflates the *trailing digit* with the *magic* — `PlZ1` also has
saveType `0x31`. **Always dispatch on the 3-byte magic first, then use the digit to pick
single vs double.** (`PST palsav.py:37-43` matches on magic; `PST compressor/zlib.py:70`
then branches on `save_type == 0x32`.)

### Decompression semantics per magic+digit

| Tag | Action |
|---|---|
| `PlZ1` | **one** zlib inflate of `data[12..]` |
| `PlZ2` | **two** zlib inflates: inflate `data[12..]`, then inflate that result |
| `PlM1` | **Oodle** decompress of `data[12 .. 12+compressedLen]`, output length = `uncompressedLen` |
| `CNK0` | Xbox/Game Pass marker — see below |

Sources: `PC CompressedSAV.cs:103-105` (`PLZ2 → DoubleDeflate`, `PLM1 → Oodle`, else
`SingleDeflate`); `PST compressor/zlib.py:68-74`; `PST compressor/oozlib.py:152-153`.

The zlib streams are plain zlib (RFC1950) — `PST` uses `zlib.decompress` with default
`wbits`, so in JS use `pako.inflate` (not `inflateRaw`). PC uses SharpZipLib's
`InflaterInputStream`, also zlib-wrapped. **PLM notes an "inner 12-byte header" between the
two deflate layers; PC and PST both show no such header — trust PC/PST.**

### Length sanity checks (from PST — PC skips these, do them anyway)

- `PlZ2` only: after the **first** inflate, `len(result) === compressedLen`
  (`PST compressor/zlib.py:71-72`). This is the strongest early corruption signal.
- All formats: final `len(result) === uncompressedLen`
  (`PST compressor/zlib.py:76-79`, `PST compressor/oozlib.py:155-158`).
- `PST compressor/__init__.py:19-20`: reject files `< 24` bytes before touching the header.
- Reject any magic not in `{PlZ, PlM, CNK}` (`PST compressor/__init__.py:35-40`).

### CNK0 (Xbox / Game Pass)

`CNK0` is a wrapper: the real header is repeated 12 bytes later.
`PST compressor/__init__.py:28-33`:

```
off  size  field
0    4     u32  (outer, ignore)
4    4     u32  (outer, ignore)
8    3     "CNK"
11   1     0x30
12   4     u32  uncompressedLen   <-- USE THESE
16   4     u32  compressedLen     <-- USE THESE
20   3     ascii magic ("PlZ"/"PlM")
23   1     u8   saveType
24   ...        payload
```

**PC and PST disagree here.** `PC CompressedSAV.cs:78-99` keeps the lengths from `0..8` and
only skips `12..20`, so a `CNK0`-wrapped `PlM1` gets the wrong output length. **Follow PST:
re-read both lengths at 12/16.** PC does cover one case PST lacks
(`PC CompressedSAV.cs:91-98`): if bytes `20..23` are *not* a known magic, the file is a
partial multi-part Xbox save whose payload starts at offset 12 with no inner header — treat
as unsupported for a first pass. `PC CompressedSAV.cs:59-61` notes CNK0 appears on newer Game
Pass saves and clears itself once the game has been closed a while.

### Which magic in practice

`PLM §2`: the magic became `PlM` (Oodle) at Palworld 0.6 and stays `PlM` through 1.0, but a
world keeps its old format until the game rewrites that file — `WorldOption.sav` may still be
`PlZ` next to a `PlM` `Level.sav`. **Support both.**

---

## 2. GVAS header

`PST gvas.py:31-62` == `PC GVAS/GvasFile.cs:31-58`. Byte offsets below were computed by
decoding the header fixture in `PST tests/test_gvas.py:16-104` (a real 1.0-era header,
1469 bytes total):

```
0x00  i32     magic                 must be 0x53415647 ("GVAS" LE)
0x04  i32     saveGameVersion       == 3      (both readers hard-fail otherwise)
0x08  i32     packageFileVersionUE4 == 522
0x0C  i32     packageFileVersionUE5 == 1008
0x10  u16     engineVersionMajor    == 5
0x12  u16     engineVersionMinor    == 1
0x14  u16     engineVersionPatch    == 1
0x16  u32     engineVersionChangelist == 0
0x1A  FString engineVersionBranch   "++UE5+Release-5.1"  (22 bytes incl. len+NUL)
0x30  i32     customVersionFormat   == 3      (both readers hard-fail otherwise)
0x34  u32     customVersionCount    (69 in the fixture)
0x38  20*N    customVersions        N × { 16-byte GUID, i32 version }
0x59C FString saveGameClassName     "/Script/Pal.PalWorldSaveGame" (33 bytes)
0x5BD ...     first property tag
```

**The header is variable-length** — `customVersionCount` and the two FStrings change its
size. Never hard-code `0x5BD`; parse through it.

Version-drift notes:
- `saveGameVersion == 3` and `customVersionFormat == 3` are asserted unconditionally by both
  readers, with no pre/post-1.0 branch. Neither repo contains any code path keyed on
  `packageFileVersion*` or `engineVersion*`, so those are informational only.
- `customVersionCount` **does** grow across game patches (69 here). Read it, don't assume.
- I found **no** version-conditional logic anywhere in `PST gvas.py` / `PC GvasFile.cs`.
  Treat "pre-1.0 header differences" as unconfirmed (see §8).

`PC GvasFile.cs:148-171` (`IsValidGvas`) is a good cheap validity probe: magic == `GVAS`,
version == 3, skip through the branch string, `customVersionFormat == 3`.

After the header comes a `properties_until_end` list (`PST gvas.py:132`), then a trailer that
should be `00 00 00 00` (`PST gvas.py:134-137`).

---

## 3. Property tag format

### 3.1 FString

`PST archive.py:314-344`, `PC FArchiveReader.cs:775-809`. Used for every name, type name and
string value — GVAS has no name table.

```
i32 len
len == 0  -> "" , no bytes follow
len >  0  -> len bytes of ASCII/latin-1, INCLUDING a trailing NUL  -> take len-1
len <  0  -> (-len) UTF-16LE code units = (-len)*2 bytes, INCLUDING a trailing NUL
             -> take (-len)*2 - 2 bytes, decode utf-16le
```

`PC FArchiveReader.cs:781` warns when `abs(len) > 1000` — a good desync tripwire; real
property names and internal IDs are well under 100 chars.

### 3.2 One property

`PST archive.py:424-433`, `PC FArchiveReader.cs:128-146`:

```
FString name      -- "None" terminates the current property list
FString type
u64     size      -- see 3.3
<type-specific tag extras>
<value, `size` bytes>
```

The `u64 size` is really UE's `i32 Size` + `i32 ArrayIndex`; ArrayIndex is always 0 in these
saves, which is why both readers get away with one u64 read.

### 3.3 Tag extras (NOT counted in `size`) and payloads

| type | tag extras after `size` | payload counted by `size` |
|---|---|---|
| `StructProperty` | FString structType, 16-byte structGuid, 1 flag byte (+16 if flag) | struct body |
| `ArrayProperty` | FString innerType, 1 flag byte (+16) | `u32 count` + elements |
| `MapProperty` | FString keyType, FString valueType, 1 flag byte (+16) | `u32` (keys-to-remove, always 0) + `u32 count` + entries |
| `EnumProperty` | FString enumType, 1 flag byte (+16) | FString value |
| `ByteProperty` | FString enumType, 1 flag byte (+16) | 1 byte if enumType=="None", else FString |
| `BoolProperty` | **1 value byte**, then 1 flag byte (+16) | **nothing — `size` is 0** |
| `IntProperty` | 1 flag byte (+16) | i32 |
| `Int64Property` | 1 flag byte (+16) | i64 |
| `FloatProperty` | 1 flag byte (+16) | f32 |
| `StrProperty` / `NameProperty` | 1 flag byte (+16) | FString |

"1 flag byte (+16)" = `optional_guid`: read one byte; if non-zero read 16 more
(`PST archive.py:411-415`, `PC FArchiveReader.cs:104-108`).

Field order per type is from `PST archive.py:435-519` and `PC FArchiveReader.cs:299-772`.
Note `BoolProperty` reads value *before* the optional guid in both
(`PST archive.py:471-472`; `PC FArchiveReader.cs:409-411`, commented "init order is reversed?").

### 3.4 How to skip a whole property

Neither PC nor PST ever skips by size — **both fully parse everything.** The skip rule below
is derived from UE's `FPropertyTag` semantics plus the one place the reference code does
arithmetic on `size`, and is independently corroborated by `PLM §3.2`:

> `PC FArchiveReader.cs:582` — for `ArrayProperty` of `ByteProperty`:
> `if (count != size - 4) throw`. Equivalently `PST archive.py:488` passes `size - 4` down and
> `PST archive.py:670` asserts `size == count`. So for `ArrayProperty`, `size` covers the
> `u32 count` plus the elements, and **excludes** the innerType FString and the flag byte.

**Skip algorithm:**

```
name = fstring();  if (name === "None") return END
type = fstring()
size = u64()
readTagExtras(type)          // per the table in 3.3 — consumes bytes NOT in `size`
dataStart = offset
offset = dataStart + size    // BoolProperty: size === 0, extras already consumed the value
```

`PLM §3.2` names the three traps this covers, all of which desync every subsequent property:
`EnumProperty`/`ByteProperty` carry an enum-name FString before the flag byte; `BoolProperty`
has `size === 0` with two unaccounted bytes; and you must skip from `dataStart`, not from the
start of the tag.

### 3.5 Bare values inside maps and arrays

Inside a `MapProperty` entry or a non-struct `ArrayProperty`, values are stored **bare** — no
name, type, size or flag byte (`PST archive.py:577-592`, `PC FArchiveReader.cs:238-297`,
`PLM §3.3`). `ArrayProperty<StructProperty>` is the exception, writing a full inner tag first
(`PST archive.py:637-643`, `PC FArchiveReader.cs:485-496`): `u32 count`, FString propName,
FString propType, `u64` (unused), FString typeName, 16-byte guid, 1 skipped byte, then
`count` bare struct values.

### 3.6 Struct values

`PST archive.py:606-632`, `PC FArchiveReader.cs:182-236`. POD struct types read as fixed
bytes: `Guid` (16), `Vector` (3×f64), `Quat` (4×f64), `LinearColor` (4×f32), `DateTime` (u64),
`Color` (4). **Anything else** is a nested property list terminated by `"None"`.

For map keys/values the struct type name is *not* in the stream — the reader consults a
type-hint table (`PST paltypes.py:24-26`, `PC PalWorldTypeHints.cs:13-15`), falling back to
`"Guid"` for keys / `"StructProperty"` for values (`PST archive.py:498-506`,
`PC FArchiveReader.cs:620-621`). A hint of `"StructProperty"` means "nested property list".

---

## 4. Path to the pals

### 4.1 Property path

```
(root property list)
 └─ worldSaveData : StructProperty<PalWorldSaveData>
     └─ CharacterSaveParameterMap : MapProperty
         ├─ Key   : StructProperty   -> nested property list (hint says "StructProperty")
         └─ Value : StructProperty   -> nested property list
             ├─ RawData           : ArrayProperty<ByteProperty>   <-- the pal lives here
             └─ CustomVersionData : ArrayProperty<ByteProperty>   (version blob, NOT a tree)
```

Hints: `PST paltypes.py:25-26` / `PC PalWorldTypeHints.cs:14-15` register both
`.worldSaveData.CharacterSaveParameterMap.Key` and `.Value` as `"StructProperty"` — i.e.
**both key and value are nested property lists, not bare GUIDs.** (Contrast
`.worldSaveData.GroupSaveDataMap.Key` = `"Guid"`, a bare 16-byte key.)

**Key** fields (`PC CharacterInstanceVisitor.cs:341-342`, corroborated `PLM §5`):
`PlayerUId : StructProperty<Guid>`, `InstanceId : StructProperty<Guid>`, and per PLM a
usually-empty `DebugName : StrProperty`.

`CharacterSaveParameterMap` is the **first** child of `worldSaveData` (`PLM §4`), which is
what makes a prefix-only decompress viable (§6).

### 4.2 `RawData` is a second property tree

`PST rawdata/character.py:17-29` is the whole sub-format:

```
decode_bytes(char_bytes):
    object         = properties_until_end()   # the pal's SaveParameter tree
    unknown_bytes  = 4 bytes
    group_id       = 16-byte GUID             # guild id
    trailing_bytes = 4 bytes
    assert EOF
```

Registered at `.worldSaveData.CharacterSaveParameterMap.Value.RawData` in
`PST paltypes.py:74-77`. `PC FArchive/Custom/CharacterReader.cs:39-53` is the same thing
minus the final 4 `trailing_bytes` — **PC does not read them**, so treat the 4 trailing bytes
as present-but-optional and do not assert EOF strictly.

`PC ICustomReader.cs:36-47` shows the mechanic: parse the `ArrayProperty` normally to get the
byte array, then run a *fresh* reader over those bytes with the same type hints.

**Do not** try to parse `CustomVersionData` the same way — it is a version blob, not a tree
(`PLM §4.1`).

### 4.3 The `SaveParameter` struct

The RawData tree has exactly one top-level property, `SaveParameter :
StructProperty<PalIndividualCharacterSaveParameter>` — confirmed by PC's visitor base path
`"{...}.Value.RawData.SaveParameter"` (`PC CharacterInstanceVisitor.cs:361`).

Fields, with the constants PC matches on (`PC CharacterInstanceVisitor.cs:154-171`) and types
per `PLM §5`:

| Field | Type | Needed? | Notes |
|---|---|---|---|
| `CharacterID` | Name | **yes** | species internal name; see 4.4 |
| `Gender` | Enum | **yes** | `EPalGenderType::Male` / `::Female` / `::None` |
| `PassiveSkillList` | Array[Name] | **yes** | internal keys (`DT_PassiveSkill_Main` row names) |
| `Talent_HP` | **Byte** | **yes** | IV 0–100 |
| `Talent_Shot` | **Byte** | **yes** | |
| `Talent_Defense` | **Byte** | **yes** | |
| `OwnerPlayerUId` | Struct<Guid> | **yes** | absent on wild/unowned pals |
| `IsPlayer` | Bool | **yes** | present only on player rows — exclude those |
| `Rank` | Byte | optional | condenser rank, defaults to 1 when absent |
| `Talent_Melee` | Byte | no | read by PC; absent from PLM's field list |
| `Level` | Byte | no | absent on level-1 pals |
| `NickName` | Str | no | |
| `IsRarePal` | Bool | no | lucky pal |
| `OldOwnerPlayerUIds` | Array[Guid] | fallback | PC falls back to `[0]` when `OwnerPlayerUId` is absent (`PC CharacterInstanceVisitor.cs:103`) |
| `SlotId` / `SlotID` | Struct | no | `{ContainerId:{ID:Guid}, SlotIndex:Int}`; **casing varies** |
| `Rank_HP`, `Rank_Attack`, `Rank_Defence`, `Rank_CraftSpeed` | Byte | no | souls |
| `EquipWaza`, `MasteredWaza` | Array[Enum] | no | active skills, `EPalWazaID::` prefixed |
| `Exp` Int64 · `Hp` Struct<FixedPoint64> · `FullStomach` Float · `FriendshipPoint` Int · `GotStatusPointList`/`GotExStatusPointList` Array[Struct] · `WorkerSick`/`PhysicalHealth`/`PalReviveTimer` | | no | |

**Everything is optional.** `PC README.md:25`: "It's common for properties to be omitted if
they're at their 'default' value, e.g. pal level (1) ... passive skills (empty list)."
`PLM §5` measured a 202-pal world: 192 have `Level`, 199 have `Talent_Shot`, 180 have
`PassiveSkillList`. A missing field is a default, not an error — PC keeps `Talent*`/`Rank`
nullable with `Rank ?? 1` (`PC CharacterInstanceVisitor.cs:236-243`, `:110`).

**Match property names case-insensitively** — PC uses `isCaseSensitive: false` throughout
(`PC CharacterInstanceVisitor.cs:187`); PSP checks both `"SlotID"` and `"SlotId"`
(`PSP domain/pal.rs:84`).

### 4.4 `CharacterID` normalization

Prefixed forms are real and must be stripped before a Paldex lookup.
`PSP dto/pal.rs:64-78` (`format_character_key`):

```
lowered = id.toLowerCase()
if (!knownPalKeys.has(id) && lowered.startsWith("boss_")) return lowered.slice(5)
if (lowered.startsWith("predator_")) return lowered.slice(9)
if (lowered.endsWith("_avatar"))     return lowered.slice(0, -7)
return lowered
```

Tests at `PSP dto/pal.rs:229-234`: `BOSS_SheepBall → sheepball`, `PREDATOR_Deer → deer`. The
`knownPalKeys` guard exists because a few pals *are* their own `BOSS_`-named catalog entry;
without a Paldex key set, unconditional stripping is the pragmatic fallback.
`PSP domain/pal.rs:73`: a pal is a boss iff `CharacterID` uppercases to a `BOSS_` prefix
**and** `IsRarePal` is false. `PSP domain/pal.rs:176,212` also key `PREDATOR_` and `GYM_`;
`PLM §5` adds `RAID_` and the `_Oilrig` / `_Tower` suffixes as non-Paldex forms. PC is
simpler — `PC CharacterInstanceVisitor.cs:48` strips only `Boss_` (case-insensitive), then
drops `"None"` and anything matching a known human (`:50-51`).

### 4.5 Gender

`localcc/PalworldModdingKit Source/Pal/Public/EPalGenderType.h:6-10` — `None`, `Male`,
`Female`. On the wire the `EnumProperty` value is prefixed: `EPalGenderType::Male`
(`PSP dto/pal.rs:12-13, 24-30`). The two references disagree on the fallback —
`PC CharacterInstanceVisitor.cs:114-119`: absent → NONE, contains "Female" → FEMALE,
**anything else → MALE**; `PSP dto/pal.rs:24-30` + `domain/pal.rs:77-80`: absent → Female,
`"None"` → None, `"Male"` → Male, **anything else → Female**. For our
`gender: 'M' | 'F' | null` contract, match explicitly instead: strip the `EPalGenderType::`
prefix, then `Male → 'M'`, `Female → 'F'`, absent or `None` → `null`.

### 4.6 Excluding players

The player character is a row in the same map. `PC CharacterInstanceVisitor.cs:208-217` reads
`IsPlayer` (default false) and branches away entirely when true — the player row carries
`NickName` but PC never builds a pal from it. `PLM §5` adds that the player row has **no
`CharacterID`**. **Filter on both:** drop rows where `IsPlayer` is true *or* `CharacterID` is
missing/`"None"` (`PC CharacterInstanceVisitor.cs:50`). PC additionally requires
`CharacterID`, `SlotID.ContainerId.ID` and `SlotID.SlotIndex` to be present
(`PC CharacterInstanceVisitor.cs:173-178, 219-225`); we don't need slot data, so require only
`CharacterID`.

---

## 5. ooz-wasm

Package `ooz-wasm`, repo `SnosMe/ooz-wasm`. **Latest 2.0.0** (2023-11-14; earlier 1.0.0,
1.0.1). **License `GPL-3.0-or-later`** — copyleft; decide deliberately before vendoring it
into a shipped bundle. Zero dependencies.

**v2.0.0 is pure ESM** (`"type": "module"`, no `main`, `exports: "./index.js"`,
`types: "./index.d.ts"`). 6 files, 169,663 B unpacked. There is **no separate `.wasm` file** —
it is base64-embedded in `build/ooz.js` (Emscripten `-s SINGLE_FILE=1`), 131,206 B of glue
decoding to a **92,143-byte (90 KB) wasm module**. No node/web/bundler variant split.

### API (`index.d.ts` v2.0.0, verbatim)

```ts
// NOTE: returned TypedArray lives in WASM memory, you can safely use it
//       until the next call to decompressUnsafe/decompress.
export function decompressUnsafe (data: Uint8Array, rawSize: number): Uint8Array;
export function decompress (data: Uint8Array, rawSize: number): Uint8Array;
```

- **Argument order is `(compressedBytes, rawSize)`** — `rawSize` is the decompressed length,
  which **must be known up front**. That is exactly the `uncompressedLen` u32 at offset 0 of
  the `.sav` (§1). The stream is not self-describing.
- `decompress` copies out of the heap; `decompressUnsafe` returns a live heap view invalidated
  by the next call. Use `decompress` unless you copy immediately.
- **Init: top-level `await` at import time** in v2 — importing the ESM module compiles the
  wasm; both functions are then synchronous. (v1.x returned `Promise<Uint8Array>` and
  lazy-loaded.) A worker must `await import('ooz-wasm')` before its first decode.
- **Failure throws, never returns null/0** (`index.js`): `res < 0` →
  `Error('Failed to decode')`; `res !== rawSize` → a size-mismatch error.
- Not wasm-bindgen — classic Emscripten (`_malloc`, `_free`, `_Kraken_Decompress`, `HEAPU8`).
  Despite the `Kraken` name it decodes the whole Oodle family; Palworld writes **Mermaid**
  (`PST compressor/oozlib.py:97-99` uses `OodleCompressor.Mermaid = 9`).
- It mallocs `rawSize + 64` internally, so **pass `uncompressedLen` unpadded**. The native
  paths pad by 128 (`PC LibOoz.cs:37`, `PST compressor/oozlib.py:39`
  `SAFE_SPACE_PADDING = 128`) — relevant only if you drive the raw wasm exports yourself.

### How iebb/PalworldSaveEditor uses it

`src/libs/save.js:38-40, 74-103` reads the 4-byte tag as one LE int32 and splits it —
`magicBytes = magic & 0x00FFFFFF` (`MAGIC_PLZ = 0x5A6C50`, `MAGIC_PLM = 0x4D6C50`),
`saveType = (magic >> 24) & 0xFF`:

```js
if (magicBytes === MAGIC_PLM) {
  decompressed = await oozDecompress(new Uint8Array(compressedData), lenDecompressed);
} else {
  switch (saveType) {
    case 0x32: compressedData = pako.inflate(compressedData);  // deliberate fallthrough
    case 0x31: compressedData = pako.inflate(compressedData); break;
  }
}
```

Same rule as §1: **magic picks ooz vs pako; the digit picks single vs double inflate.** Their
`else` branch never checks the magic is actually `PlZ`, and **the repo has no `CNK0` handling
at all** — we need our own (§1). ooz is loaded lazily and degrades gracefully
(`save.js:51-58`): `await import("./oozLoader")` in a try/catch, with `PlM` saves throwing a
clear "ooz-wasm not available" error.

### Gotchas from PR #11 (PlM/Oodle support, merged 2026-04-01, fixes issues #8/#9/#10)

1. **Before the PR there was no format detection at all** — every save was assumed zlib, so
   every post-0.6 save failed to import. The single most common port bug.
2. **The npm package's Emscripten wrapper is webpack/CRA-incompatible.** They bypassed it with
   a hand-written loader (`src/libs/oozLoader.js:1-6`), shipping `public/ooz.wasm` as a static
   asset and calling `WebAssembly.instantiate(wasmBytes, importObject)` against the
   reverse-engineered slot map (imports `a.a = _emscripten_resize_heap`,
   `a.b = _emscripten_memcpy_js`; exports `c = memory, e = _malloc, f = _free,
   g = _Kraken_Decompress`). *That file is byte-identical (SHA-256) to the blob embedded in
   `ooz-wasm@2.0.0`.* Under Vite/ESM the bypass is likely unnecessary — try the package first.
3. **Heap growth invalidates views.** Their loader calls `refreshMemory()` after every
   `_malloc` and **re-copies the compressed input after allocating the output buffer**
   (`oozLoader.js:78`) — `_malloc` can trigger `_emscripten_resize_heap`, swapping the
   `ArrayBuffer` out from under an existing `Uint8Array`. Only matters for raw-export use.
4. **Top-level await under webpack** needed `experiments.topLevelAwait: true` plus Node
   fallback stubs (`module/path/fs/url/crypto: false`) in `config-overrides.js`.
5. **There is no Oodle compressor**, so on save they rewrite `PlM` as `PlZ` double-zlib
   (`save.js:171-179`: `writeMagic = (0x32 << 24) | MAGIC_PLZ`). Irrelevant to us (read-only);
   their claim that Palworld accepts the downgrade is unverified — PR test checkbox unticked.

---

## 6. Size & performance

Numbers from `PLM §2.1, §4` (measured on real saves; PC/PST publish none):

- A lightly-played 202-pal world's `worldSaveData` children total ~8–9 MB decompressed, of
  which `CharacterSaveParameterMap` is **749 KB across 203 entries** (~3.7 KB/pal). Heavy
  siblings we never touch: `MapObjectSpawnerInStageSaveData` 4.0 MB, `MapObjectSaveData`
  1.6 MB, `ItemContainerSaveData` 648 KB, `FoliageGridSaveDataMap` 221 KB, `DungeonSaveData`
  216 KB, `DynamicItemSaveData` 170 KB.
- Large multiplayer worlds reach hundreds of MB decompressed; `PLM §4` cites a 400 MB save.
- Oodle emits blocks of at most **256 KB of output** and its matches only reference backwards
  (`PLM §2.1`). Since `CharacterSaveParameterMap` is the **first** child of `worldSaveData`
  (`PLM §4`), a prefix decode would suffice — PLM reports ~3 MB of buffer for a 400 MB save.
  **But ooz-wasm exposes no partial/streaming entry point (§8), so budget for full decode.**

### The skip-heavy walk (what PC materializes)

`PC README.md:11`: "By default the `FArchiveReader` won't preserve parsed values, relying on
`IVisitors` to extract data instead." With `archivePreserve == false`
(`PC FArchiveReader.cs:130, 168-179, 436-447, 660-671`), struct/enum/map/set properties return
`null` and the map's value dictionary is never allocated (`PC FArchiveReader.cs:637`) — PC
still *reads* every byte but retains only what a visitor grabbed, i.e. leaf values on the
registered sub-paths: `CharacterID`, `Gender`, `PassiveSkillList`, `Talent_*`, `Rank`,
`OwnerPlayerUId`, `IsPlayer`, container id/slot
(`PC CharacterInstanceVisitor.cs:154-171, 187-202`).

We can beat PC by *skipping* rather than reading (§3.4): at the `worldSaveData` level, skip
every child that isn't `CharacterSaveParameterMap` — that avoids ~90% of the bytes. Inside
each pal's `SaveParameter` tree the values are small, so just parse them.

---

## 7. Minimal parse plan

Target: `ArrayBuffer` → `OwnedPal[] { speciesId, gender: 'M'|'F'|null, passives: string[],
talents: {hp, shot, defense}, ownerUid }`.

1. **Wrapper.** Reject `< 24` bytes. Read `uncompressedLen` (u32@0), `compressedLen` (u32@4),
   `magic` (3 ascii@8), `saveType` (u8@11). If magic is `CNK`, re-read all four from
   offsets 12/16/20/23 and set `dataOffset = 24`; else `dataOffset = 12`. Reject unknown magic.
2. **Decompress.** `PlZ`+`0x32` → `pako.inflate` twice, asserting `len === compressedLen`
   after the first. `PlZ`+`0x31` → `pako.inflate` once. `PlM` → `decompress(bytes, rawSize)`
   from ooz-wasm on `data[dataOffset .. dataOffset+compressedLen]` with
   `rawSize = uncompressedLen` (unpadded — §5). Assert final length `=== uncompressedLen`.
3. **GVAS header.** Assert `u32@0 === 0x53415647` and `i32@4 === 3`. Walk the fields in §2 —
   including the variable-length branch FString, `customVersionCount * 20` bytes, and the
   class-name FString — to land on the first property tag. Assert `customVersionFormat === 3`.
4. **Find the map.** Read the root property list. For each tag: if `name !==
   "worldSaveData"`, skip it (§3.4). Descend into `worldSaveData`'s `StructProperty` (consume
   structType FString + 16-byte guid + flag byte, then read its nested property list). For
   each child: if `name !== "CharacterSaveParameterMap"`, skip it. Bail with a clear error if
   you reach `"None"` without finding it.
5. **Walk the map.** After the `MapProperty` tag extras (keyType FString, valueType FString,
   flag byte), read `u32` keys-to-remove (ignore) and `u32 count`. For each of `count`
   entries: read the **key** as a bare nested property list (terminated by `"None"`) and
   discard it; read the **value** as a bare nested property list.
6. **Extract RawData.** In the value's property list, find the `RawData` child
   (`ArrayProperty` / innerType `ByteProperty`), take its `u32 count` bytes, and skip every
   other child including `CustomVersionData`.
7. **Parse the pal.** Over the RawData bytes, run a fresh property-list read. Descend into
   `SaveParameter` (a `StructProperty`) and collect, **case-insensitively**: `CharacterID`
   (Name), `Gender` (Enum), `PassiveSkillList` (Array[Name]), `Talent_HP` / `Talent_Shot` /
   `Talent_Defense` (Byte), `OwnerPlayerUId` (Struct<Guid>), `IsPlayer` (Bool). Ignore the
   trailing 4 + 16 + 4 bytes.
8. **Filter and normalize.** Drop rows where `IsPlayer === true` or `CharacterID` is
   missing/`"None"`. `speciesId` = normalized `CharacterID` (§4.4). `gender` per §4.5.
   `passives` default `[]`. `talents` default `0` each. `ownerUid` = formatted
   `OwnerPlayerUId`, else the first `OldOwnerPlayerUIds` entry, else `null`.

### The 5 places this goes wrong

1. **Skipping a property by `size` alone.** `size` covers only the value. Every type has tag
   extras that come *after* `size` and are not counted by it, and `BoolProperty` has
   `size === 0` with its value byte hidden in the extras. Get one wrong and every subsequent
   property is garbage. Implement §3.3 exactly, and assert that the next `name` FString has
   `0 < abs(len) < 1000` and decodes to printable ASCII (`PC FArchiveReader.cs:781`).
2. **`Talent_*` and `Rank` are `ByteProperty`, not `IntProperty`** (`PLM §5`). Reading a
   `ByteProperty` with an int reader yields a silent `0` for every pal — a whole world of
   0-IV pals that looks plausible. Also note `ByteProperty`'s payload is 1 byte only when its
   enumType FString is `"None"`; otherwise the payload is an FString (§3.3).
3. **FString negative length.** `-n` means `n` UTF-16LE *code units* (`2n` bytes) including
   the NUL. Any non-ASCII nickname anywhere in the file hits this, and mis-reading it
   desyncs the whole stream. `PST archive.py:325-330`.
4. **Bare values in maps/arrays.** Map keys/values and non-struct array elements carry no
   name/type/size/flag header. Using the tagged-property reader inside a map eats bytes that
   aren't there (`PST archive.py:577-592`, `PLM §3.3`). The one exception is
   `ArrayProperty<StructProperty>`, which *does* write an inner tag (§3.5).
5. **Forgetting `RawData` is a second property tree, and that everything in it is optional.**
   The pal fields are not in the outer stream at all (`PST rawdata/character.py:17-29`).
   Inside, a missing `Talent_Shot` / `PassiveSkillList` / `Level` is the *default*, not a
   parse failure (`PC README.md:25`, `PLM §5`) — never throw on absence.

---

## 8. Not verified

- **Prefix-only Oodle decode (§6).** ooz-wasm's API is one-shot `(data, rawSize) → Uint8Array`
  with no streaming or partial-output entry point, so PLM's "decompress a prefix and stop"
  optimisation is **not reachable through the published package** — you would need to drive
  the raw wasm exports and stop early. Budget for full-buffer decompression.
- **Skip-by-size rules (§3.3, §3.4).** Neither PC nor PST skips; both fully parse. The table
  is derived from UE `FPropertyTag` semantics plus the one `size`-arithmetic assertion in the
  reference code (`PC FArchiveReader.cs:582` / `PST archive.py:488,670`), and matches
  third-party `PLM §3.2`. **Validate against a real save before trusting it** — the cheapest
  check is: skip a property, then confirm the next FString is a plausible property name.
- **Pre-1.0 GVAS header differences.** No version-conditional code exists in `PST gvas.py` or
  `PC GvasFile.cs`; the fixture in `PST tests/test_gvas.py` is a single unlabelled snapshot.
  I could not establish which game version introduced which `customVersionCount` /
  `packageFileVersionUE5` values.
- **Exact `SaveParameter` property types.** `PST rawdata/character.py` calls
  `properties_until_end()`, so it records no schema; PC reads values type-agnostically. The
  per-field types in §4.3 come from `PLM §5` (measured on a real save) and PSP's domain
  model, **not** from PST/PC. `Talent_*` as `ByteProperty` in particular is a PLM claim I
  could not confirm in PST or PC.
- **Whether `Talent_Melee` still exists.** PC reads it (`CharacterInstanceVisitor.cs:168`);
  PSP and PLM's field lists omit it. Unresolved — we don't need it.
- **CNK0 partial multi-part saves.** `PC CompressedSAV.cs:91-98` handles them; PST does not.
  Untested and out of scope.
- **Size/perf numbers (§6)** are all from third-party PLM measurements, not from PC/PST.
