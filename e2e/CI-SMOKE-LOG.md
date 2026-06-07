# CI smoke log

Intentional no-op commits used to exercise the full instanode-web CI pipeline
(typecheck → build → vitest → e2e-pr-smoke contract leg) on demand.

| Date | Why |
|---|---|
| 2026-06-07 | Verify the web CI pipeline + the `@pr-smoke` Razorpay contract-only payment leg run green after wiring test-mode (api PR #271, `PAYMENT_TEST_MODE_ENABLED`). |
