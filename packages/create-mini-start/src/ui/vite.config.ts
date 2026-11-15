/**
 * Builds the project builder page. src/ui-server.ts serves it: through Vite's
 * dev middleware when running from source, or from dist/ui after `pnpm build:ui`.
 */
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const dir = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

export default defineConfig({
  root: dir('.'),
  plugins: [react()],
  clearScreen: false,
  server: {
    // Only the builder page loads these files; ui-server.ts refuses other sites too.
    cors: false,
    fs: { allow: [dir('../..')] },
  },
  build: {
    outDir: dir('../../dist/ui'),
    emptyOutDir: true,
  },
})
