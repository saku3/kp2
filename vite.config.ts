import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { docsPlugin } from './vite-docs-plugin';
import { favoritesPlugin } from './vite-favorites-plugin';

// ttyd listens on 127.0.0.1:7681 (see scripts/ttyd.sh).
// The browser talks only to this dev server; /ws and /token are proxied to ttyd.
const TTYD = process.env.TTYD_URL ?? 'http://127.0.0.1:7681';
const proxy = {
  '/ws': { target: TTYD, ws: true },
  '/token': { target: TTYD },
};

// Markdown directory served to the browser by default. Any other local directory can be
// opened from the UI at runtime.
const DOCS_DIR = process.env.DOCS_DIR ?? 'docs';

export default defineConfig({
  plugins: [react(), docsPlugin(DOCS_DIR), favoritesPlugin()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
});
