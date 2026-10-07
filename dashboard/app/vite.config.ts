import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// Built into the folder the Worker serves as static assets, under /u/.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: '../public/u',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // During frontend dev, run the Worker locally (`npm run dev` in server/).
    proxy: { '/v1': 'http://127.0.0.1:8787' },
  },
})
