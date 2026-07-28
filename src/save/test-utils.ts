import { ParseError } from './types.ts'

/**
 * TEST-ONLY. Every parser suite asserts the same two things about a failure — its `code` (the UI
 * contract) and its `detail` (the half a bug report needs) — and each had grown its own copy of
 * these four lines. Asserting on `code` rather than on message text is the point: the codes are
 * stable and the prose is not.
 *
 * The sync pair takes a thunk (`gvas.ts`, `character.ts` throw straight away); the async pair takes
 * a promise (`parseSave`/`decompressSave` are async because the Oodle import is). Both re-throw
 * anything that is not a `ParseError`, so an unexpected `TypeError` surfaces as itself rather than
 * being flattened into a string comparison.
 */

function readParseError(error: unknown): ParseError {
  if (error instanceof ParseError) return error
  throw error
}

export function codeOfSync(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    return readParseError(error).code
  }
  throw new Error('expected a ParseError, got a successful read')
}

export function detailOfSync(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    return readParseError(error).message
  }
  throw new Error('expected a ParseError, got a successful read')
}

export async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return readParseError(error).code
  }
  throw new Error('expected a ParseError, got a successful parse')
}

export async function detailOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return readParseError(error).message
  }
  throw new Error('expected a ParseError, got a successful parse')
}
