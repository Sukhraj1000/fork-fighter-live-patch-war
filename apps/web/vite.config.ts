import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Phaser is already isolated behind a dynamic import. Its 1.39 MB lazy
    // runtime chunk compresses to ~364 kB and is loaded only when a run starts.
    chunkSizeWarningLimit: 1_500,
  },
  server: {
    port: 4173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
})
