/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import packageJson from './package.json'

// Backend API URL - use container name in Docker, localhost in native dev
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:3001'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  define: {
    // Inject version from package.json at build time
    'import.meta.env.PACKAGE_VERSION': JSON.stringify(packageJson.version)
  },
  server: {
    proxy: {
      // Proxy /api requests to backend in development
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
      // Proxy /images requests to backend for cached media images
      '/images': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/vite-env.d.ts', 'src/main.tsx'],
    },
  },
})
