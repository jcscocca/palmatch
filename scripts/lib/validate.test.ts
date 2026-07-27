import { describe, expect, it } from 'vitest'
import { SYNTHETIC_TYPES, syntheticDb, syntheticEntries } from './__fixtures__/synthetic.ts'
import { buildCombos, buildMatrix, buildPals } from './transform.ts'
import { ValidationError, validate, type ValidateInput } from './validate.ts'

function baseInput(): ValidateInput {
  const pals = buildPals(syntheticDb(), SYNTHETIC_TYPES)
  const entries = syntheticEntries()
  const { matrix, genderLocked } = buildMatrix(pals, entries)
  const { combos } = buildCombos(pals, matrix, [], genderLocked)
  return {
    pals,
    matrix,
    combos,
    goldens: { pairs: [], uniques: [], genderLocked: [], sameSpecies: [] },
    entries,
    spriteFiles: new Set(['Ay.png', 'Bee.png']),
    elementFiles: new Set(['Fire.png', 'Water.png', 'Leaf.png']),
  }
}

/** The synthetic set always trips the 299-pal gate, so assert on the specific message. */
function failuresFor(input: ValidateInput): string {
  try {
    validate(input)
  } catch (err) {
    expect(err).toBeInstanceOf(ValidationError)
    return (err as Error).message
  }
  throw new Error('expected validate() to throw')
}

describe('validate (synthetic fixtures, no cache required)', () => {
  it('throws a ValidationError listing every failed gate', () => {
    const message = failuresFor(baseInput())
    expect(message).toMatch(/expected 299 pals, got 3/)
  })

  it('fails when combos.genderLocked is empty', () => {
    const message = failuresFor(baseInput())
    expect(message).toMatch(/combos\.genderLocked has 0 entries, expected 2/)
    expect(message).toMatch(/combos\.genderLocked\[0\] must be the aGender:"F" direction/)
  })

  it('fails when a pal has no sprite source', () => {
    const input = baseInput()
    input.spriteFiles = new Set(['Ay.png'])
    expect(failuresFor(input)).toMatch(/missing sprite source for 2 pal\(s\): Bee, Bee/)
  })

  it('passes the sprite gate when two pals share one display name', () => {
    expect(failuresFor(baseInput())).not.toMatch(/missing sprite source/)
  })

  it('fails when a pal has no types', () => {
    const input = baseInput()
    input.pals = input.pals.map((p) => (p.id === 'Bbb' ? { ...p, types: [] } : p))
    expect(failuresFor(input)).toMatch(/pals with no types: Bbb/)
  })

  it('fails when a type has no element icon', () => {
    const input = baseInput()
    input.elementFiles = new Set(['Fire.png', 'Water.png'])
    expect(failuresFor(input)).toMatch(/types with no element icon: grass/)
  })

  it('fails on an unfilled matrix cell', () => {
    const input = baseInput()
    input.matrix = buildMatrix(input.pals, syntheticEntries().slice(0, 3)).matrix
    expect(failuresFor(input)).toMatch(/matrix cell\(s\) never filled/)
  })

  it('fails on an asymmetric matrix', () => {
    const input = baseInput()
    input.matrix = Uint16Array.from(input.matrix)
    input.matrix[1] = 2 // cell [Aaa][Bbb], leaving [Bbb][Aaa] untouched
    expect(failuresFor(input)).toMatch(/matrix cell\(s\) are asymmetric/)
  })

  it('fails when a unique combo disagrees with the matrix', () => {
    const input = baseInput()
    input.combos = { ...input.combos, unique: [{ a: 0, b: 1, child: 2 }] }
    expect(failuresFor(input)).toMatch(/unique combo Aaa\+Bbb claims Ccc, matrix says Aaa/)
  })

  it('fails when goldens.pairs is the wrong size', () => {
    expect(failuresFor(baseInput())).toMatch(/goldens\.pairs has 0 entries, expected 500/)
  })
})
