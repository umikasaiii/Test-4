import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds ONE self-contained index.html (JS/CSS + the meshopt car inlined as a data-URI),
// so the game can be opened from a single file / hosted as an artifact link.
export default defineConfig({
  base: './',
  assetsInclude: ['**/*.glb'],
  plugins: [viteSingleFile()],
  build: {
    target: 'esnext',
    assetsInlineLimit: 100000000, // inline every asset (the .glb) as base64
    cssCodeSplit: false,
    outDir: 'dist-inline',
    rollupOptions: { input: 'index.inline.html' }
  }
});
