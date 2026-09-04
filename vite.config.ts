import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ttyd listens on 127.0.0.1:7681 (see scripts/ttyd.sh).
// The browser talks only to this dev server; /ws and /token are proxied to ttyd.
const TTYD = process.env.TTYD_URL ?? 'http://127.0.0.1:7681';
const proxy = {
  '/ws': { target: TTYD, ws: true },
  '/token': { target: TTYD },
};

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
});
