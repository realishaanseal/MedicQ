import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, the dashboard runs on :5173 and proxies API + websocket to the server on :4000.
// Demo mode imports the rules engine from ../server/src and the simulator from ../simulator,
// so those folders must be readable and their bare imports (zod) resolved from here.
export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ['zod'] },
  server: {
    host: true,
    fs: { allow: ['..'] },
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
});
