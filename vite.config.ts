/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url))

export default defineConfig(({ mode }) => ({
  // GitHub Pages serves the app from /<repository>/. The deploy workflow sets
  // VITE_BASE to that path; local development uses '/'.
  base: process.env.VITE_BASE || '/',
  plugins: [react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 1000 },
  // `npm run sandbox`: swap the Supabase client and API for an in-browser
  // Postgres (PGlite) running the same migration. Development only.
  ...(mode === 'sandbox'
    ? {
        resolve: {
          alias: [
            { find: /^(\.\.?\/)+lib\/supabase$/, replacement: src('sandbox/supabase.ts') },
            { find: /^(\.\.?\/)+lib\/api$/, replacement: src('sandbox/api.ts') },
          ],
        },
        optimizeDeps: { exclude: ['@electric-sql/pglite'] },
      }
    : {}),
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 30000,
  },
}))
