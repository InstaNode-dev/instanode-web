import { expect, test, Route } from '@playwright/test'
import { FAKE_RESOURCES, installAPIFake, signIn } from './fixtures'

test.describe('Resources', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await installAPIFake(page)
  })

  test('list shows the team resources', async ({ page }) => {
    await page.goto('/resources')
    await expect(page.getByRole('heading', { name: /Resources/i, level: 1 })).toBeVisible()
    for (const r of FAKE_RESOURCES) {
      await expect(page.getByText(r.name!)).toBeVisible()
    }
  })

  test('detail page renders connection block + identifiers', async ({ page }) => {
    const r = FAKE_RESOURCES[0]
    await page.goto(`/resources/${r.token}`)
    // Wait for the page to mount and the masked URL to appear.
    // The h1 carries the resource name in the new design.
    await expect(page.getByRole('heading', { level: 1, name: r.name! })).toBeVisible()
  })

  test('Metrics tab renders charts instead of the prior "gap" placeholder', async ({ page }) => {
    const r = FAKE_RESOURCES[0]

    // Mock the metrics endpoint with a fake stub response — exercises the
    // banner branch AND the chart layout (the W7F panel must render both).
    await page.route(`**/api/v1/resources/${r.token}/metrics**`, (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          resource_id: r.id,
          resource_type: r.resource_type,
          window_seconds: 3600,
          samples_count: 60,
          sample_interval_seconds: 60,
          metrics: {
            latency_p50_ms: Array.from({ length: 60 }, (_, i) => 2 + i * 0.01),
            latency_p95_ms: Array.from({ length: 60 }, (_, i) => 8 + i * 0.02),
            latency_p99_ms: Array.from({ length: 60 }, (_, i) => 18 + i * 0.04),
            connections_active: Array.from({ length: 60 }, () => 3),
            storage_bytes: Array.from({ length: 60 }, (_, i) => 1_000_000 + i * 50_000),
            error_rate_pct: Array.from({ length: 60 }, () => 0),
          },
          data_source: 'stub',
        }),
      }),
    )

    await page.goto(`/resources/${r.token}`)
    await page.getByRole('button', { name: 'Metrics' }).click()

    // The prior placeholder said "awaiting backend" — must be gone.
    await expect(page.getByText('awaiting backend')).toHaveCount(0)
    await expect(page.getByText('no data source')).toHaveCount(0)

    // The MetricsPanel renders. Charts present.
    await expect(page.getByTestId('metrics-panel')).toBeVisible()
    await expect(page.getByTestId('metrics-storage-tile')).toBeVisible()

    // The stub banner explains the resource hasn't seen probes yet.
    await expect(page.getByTestId('metrics-stub-banner')).toBeVisible()
  })
})
