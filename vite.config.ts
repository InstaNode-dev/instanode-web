import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// DASHBOARD_API_URL — the upstream dashboard-api to proxy to (default: local docker-compose).
// Handles /api and /auth routes (session management, resource listing).
// Set this as a system env var or in Playwright's webServer env config.
// Do NOT use VITE_API_BASE_URL here — that would expose it to the browser, changing fetch URLs
// to absolute cross-origin and breaking Playwright's page.route() glob matchers.
const dashboardApiURL = process.env.DASHBOARD_API_URL || 'http://localhost:8081';

// AGENT_API_URL — the agent-facing instanode.dev API (port 8080 local, 30080 k8s NodePort).
// Handles /claim routes (onboarding, claim preview, claim conversion).
// Dashboard-api has no /claim routes; these must go directly to the agent API.
const agentApiURL = process.env.AGENT_API_URL || 'http://localhost:30080';

const proxy = process.env.VITE_NO_PROXY
  ? {}
  : {
      '/api': { target: dashboardApiURL, changeOrigin: true },
      '/stacks': { target: agentApiURL, changeOrigin: true },
      '/auth': {
        target: dashboardApiURL,
        changeOrigin: true,
        // SPA route — must not be proxied to dashboard-api (React reads ?code=)
        bypass(req) {
          const path = req.url?.split('?')[0] ?? '';
          if (path === '/auth/google/callback') {
            return '/index.html';
          }
        },
      },
      '/claim': { target: agentApiURL, changeOrigin: true },
    };

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // Playwright E2E lives under e2e/ — do not collect those files as Vitest suites.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    passWithNoTests: true,
  },
});
