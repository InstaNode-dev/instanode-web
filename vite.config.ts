import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// AGENT_API_URL — the agent-facing instanode.dev API (defaults to the live
// cluster; override locally with AGENT_API_URL=http://localhost:30080).
// All dashboard fetches go through this single upstream.
const agentApiURL = process.env.AGENT_API_URL || 'http://api.instanode.dev';

// GIT_SHA — injected at build time so frontend errors are stamped with the
// dashboard's build SHA (mirrors what the Go services do via -ldflags). The
// GH Actions workflow exports `GIT_SHA=$(git rev-parse --short HEAD)` before
// `npm run build`. Falls back to "dev" in local development.
const gitSHA = process.env.GIT_SHA || 'dev';

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
  // define: compile-time substitution. We splice GIT_SHA + the New Relic
  // browser-agent keys into the bundle here so `import.meta.env.VITE_*`
  // resolves to the build-time value, not whatever `process.env` happens
  // to look like at runtime (browsers don't have process.env). New Relic
  // keys are optional — when absent we stringify "" and main.tsx skips
  // init (fail-open, same shape as the Go services on NEW_RELIC_LICENSE_KEY).
  define: {
    'import.meta.env.VITE_COMMIT_ID': JSON.stringify(gitSHA),
    'import.meta.env.VITE_NEWRELIC_LICENSE_KEY': JSON.stringify(process.env.VITE_NEWRELIC_LICENSE_KEY || ''),
    'import.meta.env.VITE_NEWRELIC_APP_ID': JSON.stringify(process.env.VITE_NEWRELIC_APP_ID || ''),
  },
  server: {
    port: 5173,
    proxy,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    passWithNoTests: true,
  },
});
