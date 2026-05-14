/* marketing-ai-starter.spec.ts — Playwright guards for the "paste this
 * into your AI" starter-prompt section on the homepage.
 *
 * Coverage:
 *   1. The #ai-starter section renders on / and is scrollable into view.
 *   2. The prompt codeblock contains the literal /llms.txt URL.
 *   3. The Copy button flips its visible label to "Copied" after click.
 *   4. The visible /llms.txt link below the codeblock points at the
 *      canonical apex URL.
 *
 * Runs in MOCKED mode (default playwright.config.ts) — no upstream API
 * needed because the marketing page is fully static.
 */

import { expect, test } from '@playwright/test'

test.describe('Marketing homepage — AI starter prompt section', () => {
  test('renders #ai-starter with the prompt, working Copy button, and visible llms.txt link', async ({ page, context }) => {
    // Required for navigator.clipboard.writeText to succeed in headless
    // chromium without a user-gesture prompt. The Copy handler still
    // works without it (it catches and silently no-ops), but granting
    // the permission lets us assert the success path.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])

    await page.goto('/')

    // Section exists and is anchored at #ai-starter.
    const section = page.locator('#ai-starter')
    await expect(section).toBeVisible()
    await section.scrollIntoViewIfNeeded()

    // Headline guard — keep the section's framing recognizable.
    await expect(section.getByRole('heading', { level: 2 })).toContainText(/paste this into your ai/i)

    // Prompt codeblock contains the llms.txt URL and the /db/new endpoint.
    const prompt = page.getByTestId('ai-starter-prompt')
    await expect(prompt).toBeVisible()
    const promptText = (await prompt.textContent()) ?? ''
    expect(promptText).toContain('https://instanode.dev/llms.txt')
    expect(promptText).toContain('https://api.instanode.dev/db/new')
    expect(promptText).toContain("[describe what you're building]")

    // Visible /llms.txt link below the codeblock.
    const llmsLink = page.getByTestId('ai-starter-llms-link')
    await expect(llmsLink).toBeVisible()
    await expect(llmsLink).toHaveAttribute('href', 'https://instanode.dev/llms.txt')
    await expect(llmsLink).toContainText('https://instanode.dev/llms.txt')

    // Copy button — initial label "Copy", then "Copied" after click.
    const copyBtn = page.getByRole('button', { name: /copy starter prompt/i })
    await expect(copyBtn).toBeVisible()
    await expect(copyBtn).toHaveText(/^copy$/i)
    await copyBtn.click()
    await expect(copyBtn).toContainText(/copied/i, { timeout: 1000 })
  })
})
