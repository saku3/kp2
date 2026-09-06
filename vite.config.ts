import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the UI is served by Vite and everything else (terminal WebSocket, APIs,
// server-sent events) is proxied to the kp2 server (server/), which `npm run dev` starts on
// 127.0.0.1:7681. In production the kp2 binary serves the built UI itself.
const SERVER = process.env.KP2_SERVER_URL ?? 'http://127.0.0.1:7681';
const proxy = {
  '/ws': { target: SERVER, ws: true },
  '/token': { target: SERVER },
  '/api': { target: SERVER },
};

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
});
