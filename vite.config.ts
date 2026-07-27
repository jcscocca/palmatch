/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  // Both workers are constructed with `{ type: 'module' }`, but vite still bundles worker entries
  // as IIFE by default — and an IIFE can hold neither a top-level await nor a lazy import chunk.
  // ooz-wasm compiles its wasm under a top-level await, so the save-import worker needs ESM output.
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    passWithNoTests: true,
    // Heavy panel renders (300-row ComboTable) exceed the 5s default on 2-core CI runners.
    testTimeout: 20000,
  },
})
