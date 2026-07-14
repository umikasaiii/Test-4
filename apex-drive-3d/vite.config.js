import { defineConfig } from 'vite';

// relative base so the built game works from any static path (or file://-ish hosting)
export default defineConfig({
  base: './',
  build: { target: 'esnext', assetsInlineLimit: 0 },
  server: { host: true, port: 5173 }
});
