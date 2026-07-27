/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  // Vite bundles worker entries as IIFE by default, and a top-level await cannot live in an IIFE —
  // ooz-wasm compiles its wasm under one. Nothing reachable from the entry constructs the
  // save-import worker yet, so today's build never bundles it and this line is not yet exercised;
  // it becomes required the moment F3 puts the worker in the graph. Verified by temporarily
  // referencing the worker from main.tsx: without this the build fails with UNSUPPORTED_FEATURE at
  // ooz-wasm/index.js, with it ooz splits into its own lazy chunk. Both workers are already
  // constructed with `{ type: 'module' }`, so the call sites need no change either way.
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    passWithNoTests: true,
    // Heavy panel renders (300-row ComboTable) exceed the 5s default on 2-core CI runners.
    testTimeout: 20000,
  },
})
