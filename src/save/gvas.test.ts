import { describe, expect, it } from 'vitest'
import {
  boolProp,
  build,
  byteProp,
  enumProp,
  floatProp,
  int64Prop,
  intProp,
  levelGvas,
  nameArrayProp,
  nameProp,
  none,
  padProp,
  strProp,
  structProp,
  type Writer,
} from './fixtures/builder.ts'
import { Cursor, eachProperty, openCharacterMap, readGvasHeader, readStringArray, type PropertyTag } from './gvas.ts'
import { ParseError } from './types.ts'

function codeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof ParseError) return error.code
    throw error
  }
  throw new Error('expected a ParseError')
}

function detailOf(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof ParseError) return error.message
    throw error
  }
  throw new Error('expected a ParseError')
}

function patchU32(bytes: Uint8Array, offset: number, value: number): Uint8Array {
  const copy = bytes.slice()
  new DataView(copy.buffer).setUint32(offset, value, true)
  return copy
}

/** Reads a list, returning the tags seen and the value of the `Sentinel` property at its end. */
function walk(bytes: Uint8Array): { names: string[]; sentinel: number | null } {
  const cur = new Cursor(bytes, 'list')
  const names: string[] = []
  const out: { sentinel: number | null } = { sentinel: null }
  eachProperty(cur, (tag: PropertyTag) => {
    names.push(tag.name)
    if (tag.name !== 'Sentinel') return 'skip'
    out.sentinel = cur.i32()
    return 'read'
  })
  return { names, sentinel: out.sentinel }
}

describe('Cursor.fstring', () => {
  it('reads ASCII, empty and UTF-16 strings', () => {
    const bytes = build((w: Writer) => {
      w.fstring('CharacterID')
      w.fstring('')
      w.fstring('ぷ', true)
      w.u32(0xcafe)
    })
    const cur = new Cursor(bytes)
    expect(cur.fstring()).toBe('CharacterID')
    expect(cur.fstring()).toBe('')
    expect(cur.fstring()).toBe('ぷ')
    // A UTF-16 name mis-read as ASCII would leave the cursor short and this would be garbage.
    expect(cur.u32()).toBe(0xcafe)
  })

  it('calls an absurd length a desync rather than trying to allocate it', () => {
    const bytes = build((w: Writer) => void w.i32(0x0fffffff))
    expect(codeOf(() => new Cursor(bytes).fstring())).toBe('skip-drift')
  })

  it('reports running off the end as truncation', () => {
    const bytes = build((w: Writer) => void w.i32(40).u8(65))
    expect(codeOf(() => new Cursor(bytes).fstring())).toBe('truncated')
  })
})

describe('property skipping', () => {
  it('skips one of every property type and still lands on the next tag', () => {
    const bytes = build((w: Writer) => {
      nameProp(w, 'CharacterID', 'SheepBall')
      strProp(w, 'NickName', 'ふわふわ', true)
      enumProp(w, 'Gender', 'EPalGenderType', 'EPalGenderType::Female')
      byteProp(w, 'Rank', 3)
      intProp(w, 'FriendshipPoint', 40)
      int64Prop(w, 'Exp', 987654321)
      floatProp(w, 'FullStomach', 150.5)
      boolProp(w, 'IsRarePal', true)
      nameArrayProp(w, 'PassiveSkillList', ['PAL_ALLAttack_up2', 'Legend'])
      structProp(
        w,
        'SlotID',
        'PalContainerId',
        build((s) => {
          intProp(s, 'SlotIndex', 2)
          none(s)
        }),
      )
      padProp(w, 'DummyBytes', 300)
      intProp(w, 'Sentinel', 0x5eeded)
      none(w)
    })

    const { names, sentinel } = walk(bytes)
    expect(names).toEqual([
      'CharacterID',
      'NickName',
      'Gender',
      'Rank',
      'FriendshipPoint',
      'Exp',
      'FullStomach',
      'IsRarePal',
      'PassiveSkillList',
      'SlotID',
      'DummyBytes',
      'Sentinel',
    ])
    expect(sentinel).toBe(0x5eeded)
  })

  it('keeps a BoolProperty value in the tag extras, with a zero-length payload', () => {
    const bytes = build((w: Writer) => {
      boolProp(w, 'IsPlayer', true)
      boolProp(w, 'IsRarePal', false)
      none(w)
    })
    const cur = new Cursor(bytes)
    const seen: Array<[string, boolean | undefined, number]> = []
    eachProperty(cur, (tag) => {
      seen.push([tag.name, tag.boolValue, tag.size])
      return 'skip'
    })
    expect(seen).toEqual([
      ['IsPlayer', true, 0],
      ['IsRarePal', false, 0],
    ])
  })

  it('reads a bare string array with no per-element tag', () => {
    const bytes = build((w: Writer) => {
      nameArrayProp(w, 'PassiveSkillList', ['Legend', 'Swift'])
      none(w)
    })
    const cur = new Cursor(bytes)
    const out: string[][] = []
    eachProperty(cur, (tag) => {
      out.push(readStringArray(cur, tag))
      return 'read'
    })
    expect(out).toEqual([['Legend', 'Swift']])
  })

  it('catches a lying size before it can invent a property', () => {
    const bytes = build((w: Writer) => {
      padProp(w, 'DummyBytes', 64, 8) // claims 8 bytes more than it wrote
      intProp(w, 'Sentinel', 1)
      none(w)
    })
    expect(codeOf(() => walk(bytes))).toBe('skip-drift')
    // Landing mid-value either finds an unreadable name or an unreadable length; both say desync.
    expect(detailOf(() => walk(bytes))).toMatch(/desynced|expected a property name/)
  })

  it('catches a value that reads short of its declared size', () => {
    const bytes = build((w: Writer) => {
      intProp(w, 'Sentinel', 1)
      none(w)
    })
    // Widen Sentinel's declared size: the walker reads 4 bytes, the tag claims 8. The size sits
    // after FString "Sentinel" (4 + 9) and FString "IntProperty" (4 + 12).
    const cur = new Cursor(patchU32(bytes, 4 + 9 + 4 + 12, 8), 'list')
    expect(
      codeOf(() =>
        eachProperty(cur, (tag) => {
          expect(tag.name).toBe('Sentinel')
          expect(tag.size).toBe(8) // proves the patch landed on the size field, not next to it
          cur.i32()
          return 'read'
        }),
      ),
    ).toBe('skip-drift')
  })
})

describe('readGvasHeader', () => {
  const gvas = levelGvas({ customVersionCount: 3 })

  it('lands on the first property tag whatever the custom-version count', () => {
    for (const customVersionCount of [0, 3, 69]) {
      const cur = new Cursor(levelGvas({ customVersionCount }))
      const header = readGvasHeader(cur)
      expect(header.saveGameClassName).toBe('/Script/Pal.PalWorldSaveGame')
      expect(header.customVersionCount).toBe(customVersionCount)
      // The class name is the last header field, so the next FString is a property name.
      expect(new Cursor(cur.bytes.subarray(cur.offset)).fstring()).toBe('Version')
    }
  })

  it('puts the fixed fields where the reference says they are', () => {
    // Hand-computed from reference §2: 0x1A + 4 + 18 (the "++UE5+Release-5.1" FString) = 0x30.
    const view = new DataView(gvas.buffer, gvas.byteOffset)
    expect(view.getUint32(0x00, true)).toBe(0x53415647)
    expect(view.getInt32(0x04, true)).toBe(3)
    expect(view.getInt32(0x30, true)).toBe(3) // customVersionFormat
    expect(view.getUint32(0x34, true)).toBe(3) // customVersionCount
    expect(view.getInt32(0x38 + 3 * 20, true)).toBe(29) // class-name FString length
  })

  it('rejects a blob that is not GVAS at all', () => {
    expect(codeOf(() => readGvasHeader(new Cursor(patchU32(gvas, 0, 0x11223344))))).toBe('not-a-save')
  })

  it('rejects an unknown save-game version', () => {
    expect(codeOf(() => readGvasHeader(new Cursor(patchU32(gvas, 4, 4))))).toBe('not-a-save')
    expect(detailOf(() => readGvasHeader(new Cursor(patchU32(gvas, 4, 4))))).toMatch(/version 4, expected 3/)
  })

  it('rejects an unknown custom-version format', () => {
    expect(codeOf(() => readGvasHeader(new Cursor(patchU32(gvas, 0x30, 2))))).toBe('not-a-save')
  })

  it('reports a header cut short as truncation', () => {
    expect(codeOf(() => readGvasHeader(new Cursor(gvas.subarray(0, 0x20))))).toBe('truncated')
    expect(codeOf(() => readGvasHeader(new Cursor(patchU32(gvas, 0x34, 100000))))).toBe('truncated')
  })
})

describe('openCharacterMap', () => {
  function open(bytes: Uint8Array): number {
    const cur = new Cursor(bytes)
    const header = readGvasHeader(cur)
    return openCharacterMap(cur, header.saveGameClassName).count
  }

  it('finds the map past unrelated root and worldSaveData children', () => {
    expect(open(levelGvas({ pals: [{}, {}, {}], padBytes: 512 }))).toBe(3)
  })

  it('calls a save with no worldSaveData the wrong file, naming what it was', () => {
    const bytes = levelGvas({ omitWorldSaveData: true, className: '/Script/Pal.PalLevelMetaSaveGame' })
    expect(codeOf(() => open(bytes))).toBe('wrong-file')
    expect(detailOf(() => open(bytes))).toMatch(/PalLevelMetaSaveGame/)
  })

  it('calls a worldSaveData without the pal map the wrong file too', () => {
    expect(codeOf(() => open(levelGvas({ omitCharacterMap: true })))).toBe('wrong-file')
  })

  it('parses a save whose class name changed but whose shape did not', () => {
    expect(open(levelGvas({ className: '/Script/Pal.PalWorldSaveGame2' }))).toBe(1)
  })
})
