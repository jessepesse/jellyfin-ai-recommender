import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import packageJson from './package.json'

// Backend API URL - use container name in Docker, localhost in native dev
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:3001'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Inject version from package.json at build time
    'import.meta.env.PACKAGE_VERSION': JSON.stringify(packageJson.version)
  },
  css: {
    postcss: {
      plugins: [
        tailwindcss(),
        autoprefixer(),
      ],
    },
  },
  server: {
    proxy: {
      // Proxy /api requests to backend in development
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
})
