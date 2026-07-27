import { describe, expect, it } from 'vitest'

/**
 * Throwaway interop spike, not ongoing coverage: `ooz-wasm` is pure ESM with a top-level `await`
 * that compiles a wasm module on import (see node_modules/ooz-wasm/index.js). This confirms our
 * toolchain (vitest + esbuild transform) tolerates that shape before F2's worker builds on it —
 * the real risk was vite/vitest choking on TLA or on the wasm's SIMD requirement. It ran green
 * against ooz-wasm@2.0.0 under vitest 4 / node 25 with no config changes (tsconfig already targets
 * es2023, which supports TLA). Kept active (not skipped) since the cost is one wasm compile per
 * test run and it's a cheap tripwire if a future ooz-wasm bump changes the export shape.
 */
describe('ooz-wasm ESM/TLA interop spike', () => {
  it('dynamic-imports and exposes a decompress function', async () => {
    const mod = await import('ooz-wasm')
    expect(typeof mod.decompress).toBe('function')
    expect(typeof mod.decompressUnsafe).toBe('function')
  })
})
