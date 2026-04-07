import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    // Handles Cesium asset copying and CESIUM_BASE_URL injection
    cesium(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    // Proxy Django API and WebSocket in dev
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
})
