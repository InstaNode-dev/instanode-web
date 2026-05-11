import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// AGENT_API_URL — the agent-facing instanode.dev API (defaults to the live
// cluster; override locally with AGENT_API_URL=http://localhost:30080).
// All dashboard fetches go through this single upstream.
const agentApiURL = process.env.AGENT_API_URL || 'http://api.instanode.dev';

// In tests we set VITE_NO_PROXY=1 so Playwright's page.route() globs match
// against same-origin URLs and don't accidentally hit the live cluster.
const proxy = process.env.VITE_NO_PROXY
  ? {}
  : {
      '/api': { target: agentApiURL, changeOrigin: true },
      '/auth': { target: agentApiURL, changeOrigin: true },
      '/claim': { target: agentApiURL, changeOrigin: true },
      '/db': { target: agentApiURL, changeOrigin: true },
      '/cache': { target: agentApiURL, changeOrigin: true },
      '/nosql': { target: agentApiURL, changeOrigin: true },
      '/queue': { target: agentApiURL, changeOrigin: true },
      '/storage': { target: agentApiURL, changeOrigin: true },
      '/webhook': { target: agentApiURL, changeOrigin: true },
      '/.well-known': { target: agentApiURL, changeOrigin: true },
    };

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    passWithNoTests: true,
  },
});
