import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { miniStart } from 'mini-start/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [miniStart(), react(), tailwindcss()],
})
