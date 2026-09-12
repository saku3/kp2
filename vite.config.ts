import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { docsPlugin } from './vite-docs-plugin';
import { favoritesPlugin } from './vite-favorites-plugin';
import { editorDefaults, editorPlugin } from './vite-editor-plugin';

// ttyd listens on 127.0.0.1:7681 (see scripts/ttyd.sh) and code-server on 127.0.0.1:7682
// (scripts/code-server.sh). The browser talks only to this dev server, which proxies both.
const TTYD = process.env.TTYD_URL ?? 'http://127.0.0.1:7681';
const editor = editorDefaults();
const proxy = {
  '/ws': { target: TTYD, ws: true },
  '/token': { target: TTYD },
  // code-server under /code/. Do not set changeOrigin: code-server checks Origin against Host.
  '/code': { target: editor.codeServerUrl, ws: true, rewrite: (p: string) => p.replace(/^\/code/, '') || '/' },
};

// Extra hostnames the dev/preview server answers to besides localhost / 127.0.0.1, as a
// comma-separated list (e.g. ALLOWED_HOSTS=kp2.test with `127.0.0.1 kp2.test` in /etc/hosts).
// Unset means Vite's default: localhost only.
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);

// Markdown directory served to the browser by default. Any other local directory can be
// opened from the UI at runtime.
const DOCS_DIR = process.env.DOCS_DIR ?? 'docs';

export default defineConfig({
  plugins: [react(), docsPlugin(DOCS_DIR), favoritesPlugin(), editorPlugin(editor)],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, allowedHosts: ALLOWED_HOSTS, proxy },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true, allowedHosts: ALLOWED_HOSTS, proxy },
});
