import { ParseError } from './types.ts'

/**
 * GVAS reader, narrowed to the one path we need: root -> `worldSaveData` ->
 * `CharacterSaveParameterMap` -> per-entry `RawData` bytes. Everything else is skipped by its
 * declared size (reference §3.4) rather than parsed, which is what keeps a 400 MB save affordable —
 * the ~90% of `worldSaveData` we never look at costs one offset addition per property.
 *
 * Skipping by size is the one rule neither reference implementation actually uses (both fully parse
 * everything), so reference §8 asks for a runtime self-check. There are two, and between them every
 * property on our path is validated:
 *
 * 1. **Plausibility** (`readTag`): after a skip, the next property name must be printable ASCII of
 *    sane length. A wrong skip lands mid-value, so the following FString is garbage.
 * 2. **Consumed == declared** (`endValue`): for the properties we do parse, the bytes we read must
 *    equal the size the tag declared. This is the check that would catch a wrong tag-extras layout,
 *    since extras are *not* counted by `size`.
 *
 * Either failing throws `ParseError('skip-drift')` with the property path. We never continue on
 * garbage: a desynced walk would otherwise invent plausible-looking pals out of noise.
 */

/**
 * `PC FArchiveReader.cs:781` warns above 1000. Real property names, type names and internal ids in
 * these saves are well under 100 chars, so a longer string means we are no longer reading a string.
 */
const STRING_MAX = 1024

const GVAS_MAGIC = 0x53415647

export class Cursor {
  readonly bytes: Uint8Array
  readonly view: DataView
  offset = 0
  /** Breadcrumb for error details, set by the walker as it descends. */
  path: string

  constructor(bytes: Uint8Array, path = '') {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    this.path = path
  }

  get remaining(): number {
    return this.bytes.byteLength - this.offset
  }

  /** Position in the form error messages want: what we were reading, and where. */
  where(): string {
    return this.path === '' ? `offset ${this.offset}` : `${this.path} @${this.offset}`
  }

  private need(n: number): number {
    const at = this.offset
    if (n < 0 || at + n > this.bytes.byteLength) {
      throw new ParseError(
        'truncated',
        `${this.where()}: needed ${n} bytes but only ${this.remaining} remain of ${this.bytes.byteLength}`,
      )
    }
    this.offset = at + n
    return at
  }

  u8(): number {
    return this.view.getUint8(this.need(1))
  }

  u32(): number {
    return this.view.getUint32(this.need(4), true)
  }

  i32(): number {
    return this.view.getInt32(this.need(4), true)
  }

  /**
   * Property sizes only. UE writes `i32 Size` + `i32 ArrayIndex`, and ArrayIndex is 0 throughout
   * these saves — which is why one u64 read works, and why a non-zero high word means drift rather
   * than a 4 GB property. The low word is bounded later by the buffer itself.
   */
  u64(): number {
    const lo = this.u32()
    const hi = this.u32()
    if (hi !== 0) {
      throw new ParseError(
        'skip-drift',
        `${this.where()}: property size 0x${hi.toString(16).padStart(8, '0')}${lo.toString(16).padStart(8, '0')} is absurd`,
      )
    }
    return lo
  }

  skip(n: number): void {
    this.need(n)
  }

  /** A view into the same buffer — no copy, so a 10 MB skipped branch is never materialized. */
  take(n: number): Uint8Array {
    const at = this.need(n)
    return this.bytes.subarray(at, at + n)
  }

  /**
   * Reference §3.1. Positive length counts bytes including a trailing NUL; negative counts UTF-16LE
   * code units including a NUL. Getting the negative case wrong desyncs the whole file the moment
   * anyone names a pal in Japanese, so both are handled even though we read no user text.
   */
  fstring(): string {
    const at = this.offset
    const len = this.i32()
    if (len === 0) return ''
    if (len > STRING_MAX || len < -STRING_MAX) {
      throw new ParseError(
        'skip-drift',
        `${this.path === '' ? '' : `${this.path}: `}implausible string length ${len} at offset ${at} — the property walk has desynced`,
      )
    }
    if (len > 0) {
      const raw = this.take(len)
      let out = ''
      for (let i = 0; i < len - 1; i++) out += String.fromCharCode(raw[i])
      return out
    }
    const units = -len
    const raw = this.take(units * 2)
    let out = ''
    for (let i = 0; i < units - 1; i++) out += String.fromCharCode(raw[i * 2] | (raw[i * 2 + 1] << 8))
    return out
  }
}

/**
 * A property header: name, type, declared value size, plus the type-specific extras that sit
 * *between* the size and the value and are not counted by it (reference §3.3).
 */
export interface PropertyTag {
  name: string
  type: string
  size: number
  /** Offset of the first value byte, i.e. after the extras. */
  dataStart: number
  structType?: string
  innerType?: string
  keyType?: string
  valueType?: string
  enumType?: string
  /** BoolProperty keeps its value in the extras and declares `size` 0. */
  boolValue?: boolean
}

function plausibleName(s: string): boolean {
  if (s.length === 0 || s.length > 255) return false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x20 || c > 0x7e) return false
  }
  return true
}

function printable(s: string): string {
  const shown = s.length > 40 ? `${s.slice(0, 40)}...` : s
  return JSON.stringify(shown)
}

/** `optional_guid`: one flag byte, and 16 more when it is set (`PST archive.py:411-415`). */
function optionalGuid(cur: Cursor): void {
  if (cur.u8() !== 0) cur.skip(16)
}

/**
 * Reads one property header, or null at the `None` that ends a property list.
 *
 * Unknown property types fall back to the plain `optional_guid` extras shared by every scalar type.
 * That is right for `Int8/UInt32/Double/Text/...` and wrong only for container-shaped newcomers; a
 * wrong guess desyncs and is then caught by the plausibility check below, which is a strictly better
 * outcome than refusing to read a save because it contains one unfamiliar type.
 */
export function readTag(cur: Cursor): PropertyTag | null {
  const at = cur.offset
  const name = cur.fstring()
  if (name === 'None') return null
  if (!plausibleName(name)) {
    throw new ParseError(
      'skip-drift',
      `${cur.path === '' ? '' : `${cur.path}: `}expected a property name at offset ${at}, got ${printable(name)} — the previous property's declared size or tag layout is wrong`,
    )
  }
  const type = cur.fstring()
  if (!plausibleName(type)) {
    throw new ParseError('skip-drift', `${cur.where()}: property ${printable(name)} has an unreadable type name ${printable(type)}`)
  }
  const size = cur.u64()

  const tag: PropertyTag = { name, type, size, dataStart: 0 }
  switch (type) {
    case 'StructProperty':
      tag.structType = cur.fstring()
      cur.skip(16)
      optionalGuid(cur)
      break
    case 'ArrayProperty':
    case 'SetProperty':
      tag.innerType = cur.fstring()
      optionalGuid(cur)
      break
    case 'MapProperty':
      tag.keyType = cur.fstring()
      tag.valueType = cur.fstring()
      optionalGuid(cur)
      break
    case 'EnumProperty':
    case 'ByteProperty':
      tag.enumType = cur.fstring()
      optionalGuid(cur)
      break
    case 'BoolProperty':
      // Value before guid in both readers (`PC FArchiveReader.cs:409-411` calls it reversed).
      tag.boolValue = cur.u8() !== 0
      optionalGuid(cur)
      break
    default:
      optionalGuid(cur)
  }
  tag.dataStart = cur.offset
  return tag
}

/** Property path for an error detail, e.g. `worldSaveData.CharacterSaveParameterMap`. */
function pathTo(cur: Cursor, tag: PropertyTag): string {
  return cur.path === '' ? tag.name : `${cur.path}.${tag.name}`
}

/** Jump past a value we don't want. The only line in the parser that makes big saves cheap. */
export function skipValue(cur: Cursor, tag: PropertyTag): void {
  const end = tag.dataStart + tag.size
  if (end > cur.bytes.byteLength) {
    throw new ParseError(
      'truncated',
      `${pathTo(cur, tag)} (${tag.type}): declares ${tag.size} bytes at ${tag.dataStart}, past the end of a ${cur.bytes.byteLength}-byte blob`,
    )
  }
  cur.offset = end
}

/** The self-check of reference §8: a value we parsed must consume exactly what its tag declared. */
export function endValue(cur: Cursor, tag: PropertyTag): void {
  const consumed = cur.offset - tag.dataStart
  if (consumed !== tag.size) {
    throw new ParseError(
      'skip-drift',
      `${pathTo(cur, tag)} (${tag.type}): read ${consumed} bytes but the tag declares ${tag.size}`,
    )
  }
}

/**
 * What a visitor did with a property's value:
 * `skip` — leave it to the walker (the common case), `read` — consumed it exactly, which the walker
 * verifies, `stop` — descended into it and deliberately abandoned the walk part-way, so there is
 * nothing to verify and nothing after it in this list will be read.
 */
export type Visit = (tag: PropertyTag) => 'skip' | 'read' | 'stop'

/** Reads a property list up to its `None` terminator. */
export function eachProperty(cur: Cursor, visit: Visit): void {
  for (;;) {
    const tag = readTag(cur)
    if (tag === null) return
    const action = visit(tag)
    if (action === 'stop') return
    if (action === 'skip') skipValue(cur, tag)
    else endValue(cur, tag)
  }
}

/** Reads and discards a bare property list (map keys). */
export function skipPropertyList(cur: Cursor): void {
  eachProperty(cur, () => 'skip')
}

export interface GvasHeader {
  saveGameClassName: string
  customVersionCount: number
}

/**
 * Reference §2. The header is variable-length — the engine-branch FString, the custom-version array
 * and the class name all move the first property tag — so every field is walked, never offset-hopped.
 */
export function readGvasHeader(cur: Cursor): GvasHeader {
  const magic = cur.u32()
  if (magic !== GVAS_MAGIC) {
    throw new ParseError(
      'not-a-save',
      `expected a GVAS blob, found magic 0x${magic.toString(16).padStart(8, '0')} — the file decompressed but isn't an Unreal save`,
    )
  }
  const saveGameVersion = cur.i32()
  if (saveGameVersion !== 3) {
    throw new ParseError('not-a-save', `GVAS save-game version ${saveGameVersion}, expected 3`)
  }
  cur.skip(4 + 4) // packageFileVersionUE4, packageFileVersionUE5
  cur.skip(2 + 2 + 2 + 4) // engine version major/minor/patch/changelist
  cur.fstring() // engine version branch
  const customVersionFormat = cur.i32()
  if (customVersionFormat !== 3) {
    throw new ParseError('not-a-save', `GVAS custom-version format ${customVersionFormat}, expected 3`)
  }
  const customVersionCount = cur.u32()
  // 69 in the 1.0-era fixture and growing with each patch; 20 bytes each, so bound it by the file.
  if (customVersionCount * 20 > cur.remaining) {
    throw new ParseError('truncated', `GVAS header claims ${customVersionCount} custom versions, more than the file holds`)
  }
  cur.skip(customVersionCount * 20)
  const saveGameClassName = cur.fstring()
  return { saveGameClassName, customVersionCount }
}

/** `u32 count` + `count` bytes, with PC's cross-check that the count fills the declared value. */
export function readByteArray(cur: Cursor, tag: PropertyTag): Uint8Array {
  const count = cur.u32()
  if (count !== tag.size - 4) {
    throw new ParseError(
      'skip-drift',
      `${pathTo(cur, tag)}: byte array declares ${count} elements inside a ${tag.size}-byte value`,
    )
  }
  return cur.take(count)
}

/** `u32 count` + bare FStrings (no per-element tag — reference §3.5). */
export function readStringArray(cur: Cursor, tag: PropertyTag): string[] {
  const count = cur.u32()
  if (count > cur.remaining) {
    throw new ParseError('skip-drift', `${pathTo(cur, tag)}: array claims ${count} elements with ${cur.remaining} bytes left`)
  }
  const out: string[] = []
  for (let i = 0; i < count; i++) out.push(cur.fstring())
  return out
}

export interface CharacterMap {
  tag: PropertyTag
  count: number
}

/**
 * Walks the root property list to `worldSaveData.CharacterSaveParameterMap` and stops on its first
 * entry, returning the entry count and the map's tag (so the caller can verify total consumption
 * once every entry is read — the strongest end-to-end check we have on the whole walk).
 *
 * The save-game class name is *reported*, not required: `className` only shapes the error message.
 * A save whose class string changed in a game patch but still contains `worldSaveData` parses fine;
 * one without it is the wrong file regardless of what it calls itself.
 */
export function openCharacterMap(cur: Cursor, className: string): CharacterMap {
  // A holder rather than a `let`: TypeScript doesn't track assignments made inside the visitor.
  const out: { found: CharacterMap | null } = { found: null }

  eachProperty(cur, (tag) => {
    if (tag.name.toLowerCase() !== 'worldsavedata') return 'skip'
    if (tag.type !== 'StructProperty') {
      throw new ParseError('wrong-file', `worldSaveData is a ${tag.type}, expected a StructProperty`)
    }
    cur.path = 'worldSaveData'
    eachProperty(cur, (child) => {
      if (child.name.toLowerCase() !== 'charactersaveparametermap') return 'skip'
      if (child.type !== 'MapProperty') {
        throw new ParseError('wrong-file', `CharacterSaveParameterMap is a ${child.type}, expected a MapProperty`)
      }
      cur.path = 'CharacterSaveParameterMap'
      cur.u32() // keys-to-remove, always 0
      const count = cur.u32()
      // Every entry writes at least a key/value terminator pair, so this bounds a corrupt count.
      if (count > cur.remaining) {
        throw new ParseError('skip-drift', `CharacterSaveParameterMap claims ${count} entries with ${cur.remaining} bytes left`)
      }
      out.found = { tag: child, count }
      return 'stop'
    })
    return 'stop'
  })

  if (out.found === null) {
    throw new ParseError(
      'wrong-file',
      `no worldSaveData.CharacterSaveParameterMap in this save (save-game class ${printable(className)}) — Palworld keeps pals in Level.sav`,
    )
  }
  return out.found
}

/**
 * One map entry: the key (a nested property list of GUIDs) is read and dropped, the value is scanned
 * for its `RawData` child. The value list is always read to its terminator even after `RawData` is
 * found — bailing early would leave the cursor mid-entry and desync every entry after it.
 */
export function readEntryRawData(cur: Cursor, index: number): Uint8Array | null {
  cur.path = `CharacterSaveParameterMap[${index}].Key`
  skipPropertyList(cur)
  cur.path = `CharacterSaveParameterMap[${index}].Value`
  let raw: Uint8Array | null = null
  eachProperty(cur, (tag) => {
    // CustomVersionData is the same shape but is a version blob, not a tree (reference §4.2).
    if (tag.name.toLowerCase() !== 'rawdata' || tag.type !== 'ArrayProperty') return 'skip'
    raw = readByteArray(cur, tag)
    return 'read'
  })
  return raw
}
