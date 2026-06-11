/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Scheduled-maintenance toggle. '1' renders the customer-facing
   *  maintenance banner + modal (src/components/MaintenanceNotice.tsx);
   *  unset or '0' renders nothing. Set on the GitHub Pages build step in
   *  .github/workflows/deploy-pages.yml; left unset in CI/test so the gate
   *  and Playwright suites build with the notice OFF. */
  readonly VITE_MAINTENANCE_MODE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
