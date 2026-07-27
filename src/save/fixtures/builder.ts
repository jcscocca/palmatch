import { deflate } from 'pako'

/**
 * TEST-ONLY byte writer: synthesizes real `.sav` files — wrapper, GVAS header, property tags and
 * `RawData` sub-trees — from the layout in `docs/superpowers/reference/save-format.md`. Nothing
 * derived from a real save is ever committed to this repo, so every fixture is built from scratch.
 *
 * **This is the mirror image of the parser, and that is a hazard**: a builder bug and a parser bug
 * that share a wrong assumption cancel out, and every round-trip test still passes. The defence is
 * in `character.test.ts`, which pins one fixture against a hand-computed hex literal derived from
 * the reference doc rather than from this file — if the two ever disagree, one of them is wrong.
 *
 * Nothing here imports the parser; it is written from the spec, independently.
 */

export class Writer {
  private buf = new Uint8Array(4096)
  private len = 0

  private ensure(n: number): number {
    if (this.len + n > this.buf.length) {
      let size = this.buf.length * 2
      while (size < this.len + n) size *= 2
      const grown = new Uint8Array(size)
      grown.set(this.buf.subarray(0, this.len))
      this.buf = grown
    }
    const at = this.len
    this.len += n
    return at
  }

  // Every write takes the offset from `ensure` first: `this.buf` is a different array afterwards
  // whenever the buffer grew, and JS evaluates the target of `this.buf[...] =` before the index.
  u8(value: number): this {
    const at = this.ensure(1)
    this.buf[at] = value
    return this
  }

  u16(value: number): this {
    const at = this.ensure(2)
    this.buf[at] = value & 0xff
    this.buf[at + 1] = (value >>> 8) & 0xff
    return this
  }

  u32(value: number): this {
    const at = this.ensure(4)
    for (let i = 0; i < 4; i++) this.buf[at + i] = (value >>> (i * 8)) & 0xff
    return this
  }

  i32(value: number): this {
    return this.u32(value >>> 0)
  }

  u64(value: number): this {
    return this.u32(value >>> 0).u32(Math.floor(value / 2 ** 32))
  }

  bytes(value: Uint8Array): this {
    const at = this.ensure(value.length)
    this.buf.set(value, at)
    return this
  }

  zeros(n: number): this {
    this.ensure(n)
    return this
  }

  /** Reference §3.1: positive length counts bytes including the NUL, negative counts UTF-16 units. */
  fstring(value: string, utf16 = false): this {
    if (value === '') return this.i32(0)
    if (!utf16) {
      this.i32(value.length + 1)
      for (let i = 0; i < value.length; i++) this.u8(value.charCodeAt(i))
      return this.u8(0)
    }
    this.i32(-(value.length + 1))
    for (let i = 0; i < value.length; i++) this.u16(value.charCodeAt(i))
    return this.u16(0)
  }

  guid(seed = 0): this {
    for (let i = 0; i < 16; i++) this.u8(seed === 0 ? 0 : (seed * 31 + i) & 0xff)
    return this
  }

  done(): Uint8Array {
    return this.buf.slice(0, this.len)
  }
}

export function build(fn: (w: Writer) => void): Uint8Array {
  const w = new Writer()
  fn(w)
  return w.done()
}

/**
 * One tagged property. `size` counts the value only — the type-specific extras written between the
 * size and the value are deliberately not included (reference §3.3), which is exactly the trap the
 * parser's skip logic has to get right. `sizeDelta` lies about it, to build corrupted fixtures.
 */
function prop(w: Writer, name: string, type: string, extras: (w: Writer) => void, value: Uint8Array, sizeDelta = 0): void {
  w.fstring(name).fstring(type).u64(value.length + sizeDelta)
  extras(w)
  w.bytes(value)
}

const noGuid = (w: Writer): void => void w.u8(0)

export function nameProp(w: Writer, name: string, value: string, type = 'NameProperty'): void {
  prop(w, name, type, noGuid, build((v) => void v.fstring(value)))
}

export function strProp(w: Writer, name: string, value: string, utf16 = false): void {
  prop(w, name, 'StrProperty', noGuid, build((v) => void v.fstring(value, utf16)))
}

export function enumProp(w: Writer, name: string, enumType: string, value: string): void {
  prop(w, name, 'EnumProperty', (e) => void e.fstring(enumType).u8(0), build((v) => void v.fstring(value)))
}

export function byteProp(w: Writer, name: string, value: number): void {
  prop(w, name, 'ByteProperty', (e) => void e.fstring('None').u8(0), build((v) => void v.u8(value)))
}

export function intProp(w: Writer, name: string, value: number): void {
  prop(w, name, 'IntProperty', noGuid, build((v) => void v.i32(value)))
}

export function int64Prop(w: Writer, name: string, value: number): void {
  prop(w, name, 'Int64Property', noGuid, build((v) => void v.u64(value)))
}

export function floatProp(w: Writer, name: string, value: number): void {
  prop(
    w,
    name,
    'FloatProperty',
    noGuid,
    build((v) => {
      const f = new Uint8Array(4)
      new DataView(f.buffer).setFloat32(0, value, true)
      v.bytes(f)
    }),
  )
}

/** BoolProperty writes its value in the extras and declares size 0 — the classic desync trap. */
export function boolProp(w: Writer, name: string, value: boolean): void {
  prop(w, name, 'BoolProperty', (e) => void e.u8(value ? 1 : 0).u8(0), new Uint8Array(0))
}

export function nameArrayProp(w: Writer, name: string, values: string[], innerType = 'NameProperty'): void {
  prop(
    w,
    name,
    'ArrayProperty',
    (e) => void e.fstring(innerType).u8(0),
    build((v) => {
      v.u32(values.length)
      for (const value of values) v.fstring(value)
    }),
  )
}

export function byteArrayProp(w: Writer, name: string, value: Uint8Array, sizeDelta = 0): void {
  prop(
    w,
    name,
    'ArrayProperty',
    (e) => void e.fstring('ByteProperty').u8(0),
    build((v) => void v.u32(value.length).bytes(value)),
    sizeDelta,
  )
}

/** A skipped sibling of any size, without allocating a JS array per byte. */
export function padProp(w: Writer, name: string, byteCount: number, sizeDelta = 0): void {
  prop(
    w,
    name,
    'ArrayProperty',
    (e) => void e.fstring('ByteProperty').u8(0),
    build((v) => void v.u32(byteCount).zeros(byteCount)),
    sizeDelta,
  )
}

export function structProp(w: Writer, name: string, structType: string, body: Uint8Array, sizeDelta = 0): void {
  prop(w, name, 'StructProperty', (e) => void e.fstring(structType).guid().u8(0), body, sizeDelta)
}

/**
 * The one array shape that is not bare (reference §3.5): an `ArrayProperty<StructProperty>` writes
 * a full inner tag — count, prop name, prop type, an unused u64, the struct type name, a GUID and a
 * skipped byte — before its elements, which are then bare struct bodies. All of it is inside the
 * outer tag's declared `size`, so a parser that skips by size crosses it without knowing any of
 * this; one that assumed bare elements would desync. `GotStatusPointList` is this shape in a real
 * pal, which makes it the likeliest thing to break a first contact with a real save.
 */
export function structArrayProp(
  w: Writer,
  name: string,
  structType: string,
  entries: Uint8Array[],
  sizeDelta = 0,
): void {
  const elements = build((v) => {
    for (const entry of entries) v.bytes(entry)
  })
  prop(
    w,
    name,
    'ArrayProperty',
    (e) => void e.fstring('StructProperty').u8(0),
    build((v) => {
      v.u32(entries.length)
      v.fstring(name)
      v.fstring('StructProperty')
      v.u64(elements.length)
      v.fstring(structType)
      v.guid()
      v.u8(0)
      v.bytes(elements)
    }),
    sizeDelta,
  )
}

/** A nested property list's terminator; struct bodies include it in their declared size. */
export function none(w: Writer): void {
  w.fstring('None')
}

export interface PalSpec {
  /** Omitted entirely when null — which is how the player's own row looks. */
  characterId?: string | null
  gender?: 'Male' | 'Female' | 'None' | null
  passives?: string[] | null
  talents?: { hp?: number; shot?: number; defense?: number } | null
  /** Reference §8 can't confirm which of these ships; both must parse. `float` is neither — it
   * stands in for a future shape we don't understand, which must warn rather than read as zero. */
  talentType?: 'byte' | 'int' | 'float'
  isPlayer?: boolean | null
  /** A UTF-16 nickname, so fixtures exercise the negative-length FString the parser must skip past. */
  nickName?: string | null
  /** Property types we never read, present so the skip table is exercised on every entry. */
  clutter?: boolean
  /** Lies about the size of the `GotStatusPointList` array, so skipping it lands mid-value. */
  corruptStatusListSize?: number
}

/**
 * The `SaveParameter` tree that lives inside one map entry's `RawData`, plus the 4 unknown bytes,
 * guild GUID and 4 trailing bytes that follow it (reference §4.2).
 */
export function characterRawData(spec: PalSpec = {}): Uint8Array {
  const {
    characterId = 'SheepBall',
    gender = 'Female',
    passives = null,
    talents = null,
    talentType = 'byte',
    isPlayer = null,
    nickName = null,
    clutter = false,
    corruptStatusListSize = 0,
  } = spec

  const number = talentType === 'byte' ? byteProp : talentType === 'int' ? intProp : floatProp
  const body = build((b) => {
    if (characterId !== null) nameProp(b, 'CharacterID', characterId)
    if (gender !== null) enumProp(b, 'Gender', 'EPalGenderType', `EPalGenderType::${gender}`)
    if (nickName !== null) strProp(b, 'NickName', nickName, true)
    if (passives !== null) nameArrayProp(b, 'PassiveSkillList', passives)
    if (talents?.hp !== undefined) number(b, 'Talent_HP', talents.hp)
    if (talents?.shot !== undefined) number(b, 'Talent_Shot', talents.shot)
    if (talents?.defense !== undefined) number(b, 'Talent_Defense', talents.defense)
    if (clutter) {
      int64Prop(b, 'Exp', 1234567)
      floatProp(b, 'FullStomach', 150.5)
      byteProp(b, 'Rank', 1)
      structProp(b, 'OwnerPlayerUId', 'Guid', build((g) => void g.guid(3)))
      structProp(
        b,
        'SlotID',
        'PalContainerId',
        build((s) => {
          structProp(s, 'ContainerId', 'Guid', build((g) => void g.guid(4)))
          intProp(s, 'SlotIndex', 2)
          none(s)
        }),
      )
      nameArrayProp(b, 'MasteredWaza', ['EPalWazaID::PowerShot'], 'EnumProperty')
      structArrayProp(
        b,
        'GotStatusPointList',
        'PalGotStatusPoint',
        [
          ['Hp', 3],
          ['ShotAttack', 1],
        ].map(([statusName, point]) =>
          build((s) => {
            nameProp(s, 'StatusName', String(statusName))
            intProp(s, 'StatusPoint', Number(point))
            none(s)
          }),
        ),
        corruptStatusListSize,
      )
    }
    // Written last on purpose: with `clutter` on, reading it correctly means the walk crossed
    // every awkward shape above it — including the struct array — without drifting.
    if (isPlayer !== null) boolProp(b, 'IsPlayer', isPlayer)
    none(b)
  })

  return build((w) => {
    structProp(w, 'SaveParameter', 'PalIndividualCharacterSaveParameter', body)
    none(w)
    w.u32(0).guid(7).u32(0) // unknown 4 + guild guid + trailing 4
  })
}

/** One `CharacterSaveParameterMap` entry: a key list of GUIDs, then a value list holding RawData. */
function mapEntry(w: Writer, index: number, raw: Uint8Array): void {
  structProp(w, 'PlayerUId', 'Guid', build((g) => void g.guid(index + 1)))
  structProp(w, 'InstanceId', 'Guid', build((g) => void g.guid(index + 2)))
  none(w)

  byteArrayProp(w, 'RawData', raw)
  byteArrayProp(w, 'CustomVersionData', new Uint8Array([1, 0, 0, 0]))
  none(w)
}

export interface SaveSpec {
  pals?: PalSpec[]
  /** Reported in errors, never matched on — see `openCharacterMap`. */
  className?: string
  customVersionCount?: number
  /** Bytes of skipped sibling written before the map, to prove the walk doesn't materialize it. */
  padBytes?: number
  /** Lie about the padding property's size, so the next property name lands mid-value. */
  corruptPadSize?: number
  /** Lie about the map's size, so consumed != declared once every entry is read. */
  corruptMapSize?: number
  /** Produces a save with no `worldSaveData` at all, like a LevelMeta.sav. */
  omitWorldSaveData?: boolean
  /** Keeps `worldSaveData` but drops the pal map — a save shaped right but holding no characters. */
  omitCharacterMap?: boolean
}

/** A complete uncompressed GVAS blob for a `Level.sav`. */
export function levelGvas(spec: SaveSpec = {}): Uint8Array {
  const {
    pals = [{}],
    className = '/Script/Pal.PalWorldSaveGame',
    customVersionCount = 3,
    padBytes = 0,
    corruptPadSize = 0,
    corruptMapSize = 0,
    omitWorldSaveData = false,
    omitCharacterMap = false,
  } = spec

  const entries = build((e) => {
    e.u32(0) // keys to remove
    e.u32(pals.length)
    pals.forEach((pal, i) => mapEntry(e, i, characterRawData(pal)))
  })

  const worldSaveData = build((b) => {
    // A heavy sibling ahead of the map, exactly where the real save keeps ~90% of its bytes.
    if (padBytes > 0) padProp(b, 'MapObjectSaveData', padBytes, corruptPadSize)
    if (!omitCharacterMap) {
      prop(
        b,
        'CharacterSaveParameterMap',
        'MapProperty',
        (x) => void x.fstring('StructProperty').fstring('StructProperty').u8(0),
        entries,
        corruptMapSize,
      )
    }
    padProp(b, 'ItemContainerSaveData', 64)
    none(b)
  })

  return build((w) => {
    w.u32(0x53415647) // GVAS
    w.i32(3) // saveGameVersion
    w.i32(522).i32(1008) // packageFileVersionUE4 / UE5
    w.u16(5).u16(1).u16(1).u32(0) // engine version + changelist
    w.fstring('++UE5+Release-5.1')
    w.i32(3) // customVersionFormat
    w.u32(customVersionCount)
    for (let i = 0; i < customVersionCount; i++) w.guid(i + 1).i32(1)
    w.fstring(className)

    intProp(w, 'Version', 100)
    if (!omitWorldSaveData) structProp(w, 'worldSaveData', 'PalWorldSaveData', worldSaveData)
    none(w)
    w.u32(0) // gvas trailer
  })
}

function wrap(magic: string, saveType: number, uncompressedLen: number, payload: Uint8Array): ArrayBuffer {
  const out = build((w) => {
    w.u32(uncompressedLen)
    w.u32(payload.length)
    for (const ch of magic) w.u8(ch.charCodeAt(0))
    w.u8(saveType)
    w.bytes(payload)
  })
  return out.buffer as ArrayBuffer
}

/** Single-deflate `.sav`. */
export function plz1(gvas: Uint8Array): ArrayBuffer {
  return wrap('PlZ', 0x31, gvas.length, deflate(gvas))
}

/** Double-deflate `.sav`; its `compressedLen` describes the intermediate blob, not the payload. */
export function plz2(gvas: Uint8Array): ArrayBuffer {
  const once = deflate(gvas)
  const twice = deflate(once)
  const out = build((w) => {
    w.u32(gvas.length)
    w.u32(once.length)
    for (const ch of 'PlZ') w.u8(ch.charCodeAt(0))
    w.u8(0x32)
    w.bytes(twice)
  })
  return out.buffer as ArrayBuffer
}

/**
 * Oodle-flavoured `.sav`. The payload is arbitrary because there is no Oodle *compressor* anywhere
 * in reach — tests inject a decompressor that recognises it and hands back `gvas`.
 */
export function plm1(gvas: Uint8Array, payload = new Uint8Array(16).fill(0x8c)): ArrayBuffer {
  return wrap('PlM', 0x31, gvas.length, payload)
}

/** Xbox / Game Pass container: the real header repeats 12 bytes in. */
export function cnk0(inner: ArrayBuffer): ArrayBuffer {
  const out = build((w) => {
    w.u32(0).u32(0)
    for (const ch of 'CNK') w.u8(ch.charCodeAt(0))
    w.u8(0x30)
    w.bytes(new Uint8Array(inner))
  })
  return out.buffer as ArrayBuffer
}

export function truncateTo(buffer: ArrayBuffer, byteLength: number): ArrayBuffer {
  return buffer.slice(0, byteLength)
}

/** A file that is not a save at all, with a magic nobody claims. */
export function junkFile(byteLength = 64): ArrayBuffer {
  const out = build((w) => {
    w.u32(0xdeadbeef).u32(0x12345678)
    for (const ch of 'XYZ') w.u8(ch.charCodeAt(0))
    w.u8(0x39)
    for (let i = 0; i < byteLength - 12; i++) w.u8((i * 37) & 0xff)
  })
  return out.buffer as ArrayBuffer
}

export function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

/** Reads an annotated hex literal: whitespace and `//` comments are ignored. */
export function fromHex(text: string): Uint8Array {
  const clean = text.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}
