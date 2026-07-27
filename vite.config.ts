/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    passWithNoTests: true,
    // Heavy panel renders (300-row ComboTable) exceed the 5s default on 2-core CI runners.
    testTimeout: 20000,
  },
})
