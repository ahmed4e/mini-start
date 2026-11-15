/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // A browser-like DOM, so components can render in tests.
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
