import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, the dashboard runs on :5173 and proxies API + websocket to the server on :4000.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
});
