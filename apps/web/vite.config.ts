/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// En Docker la API se llama "api"; en su equipo, localhost.
const destinoApi = process.env.VITE_API_PROXY ?? 'http://localhost:8000';

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  server: {
    host: true,
    port: Number(process.env.WEB_PORT ?? 5173),
    // Mismo origen para la web y la API: la cookie del refresh token funciona sin CORS.
    proxy: { '/api': { target: destinoApi, changeOrigin: true } },
  },
  preview: { port: 4173 },
  build: {
    // Las fuentes van como archivos, nunca como data: en el CSS: la CSP de nginx (font-src 'self') las bloquearía.
    assetsInlineLimit: (archivo) => (/\.woff2?$/.test(archivo) ? false : undefined),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
  },
});
