/**
 * `ooz-wasm` (GPL-3.0) is loaded lazily via dynamic `import()` — only a `PlM1`-magic save needs
 * Oodle decompression, so the wasm chunk should never touch the initial bundle. It's pure ESM
 * with a top-level `await` compiling the wasm module on import; F2's worker awaits this once and
 * reuses the returned `decompress` fn for every entry in a save.
 */
export type OozDecompress = (data: Uint8Array, rawSize: number) => Uint8Array

export async function loadOoz(): Promise<OozDecompress> {
  const mod = await import('ooz-wasm')
  return mod.decompress
}
