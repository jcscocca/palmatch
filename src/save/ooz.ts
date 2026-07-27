/**
 * `ooz-wasm` (GPL-3.0) is loaded lazily via dynamic `import()` — only a `PlM1`-magic save needs
 * Oodle decompression, so the wasm chunk should never touch the initial bundle. It's pure ESM
 * with a top-level `await` compiling the wasm module on import; the save-import worker awaits this
 * once per `PlM1` save and hands the result straight to `decompressSave`.
 *
 * `rawSize` is the decompressed length, which the stream doesn't carry — it comes from the `.sav`
 * header. The package also exports `decompressUnsafe`, which returns a live view into the wasm heap
 * that the next call invalidates; we take `decompress`, which copies out, because the result
 * outlives the call by the entire GVAS walk.
 */
export type OozDecompress = (data: Uint8Array, rawSize: number) => Uint8Array

export async function loadOoz(): Promise<OozDecompress> {
  const mod = await import('ooz-wasm')
  return mod.decompress
}
