/* llmsContract.test.ts — agent-facing docs contract regression test.
 *
 * CLAUDE.md rule 22 ("contract changes touch all surfaces in one PR") and
 * rule 18 ("registry-iterating regression tests, not hand-typed lists")
 * together require that any agent-visible contract added to the API has a
 * test that fails if the docs silently drift. This file is the single
 * place that owns the docs-coverage assertions for that contract.
 *
 * The CONTRACT_MARKERS registry below lists every (file, substring) pair
 * the docs must mention. To add a new field to the contract, append a new
 * row — the test iterates the registry so a missing site fails by name,
 * not silently. To remove a row, document why in the PR (the field is no
 * longer agent-facing).
 *
 * The `redeploy` rows below were added with the `docs/deploy-new-redeploy-param`
 * PR, which mirrors the `redeploy=true` form field on POST /deploy/new that
 * the api adds in the parallel PR. Until that api PR ships, the live API
 * will reject the flag, but the docs are additive and safe to land first.
 *
 * NOTE on the build pipeline: `npm run build` runs scripts/fetch-content.mjs
 * before `vite build`, which would normally overwrite public/llms.txt from
 * the InstaNode-dev/content repo. The script now PRESERVES the local
 * public/llms.txt if upstream is missing the required markers (see
 * SYNC_FILES.requireMarkers in fetch-content.mjs) — so this test passes in
 * CI even before the content-repo follow-up PR lands. Once the content-repo
 * PR ships, both sides have the markers and the guard becomes a no-op.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

// Resolve from instanode-web/ project root regardless of where vitest is
// invoked from. import.meta.url is file:///…/src/lib/llmsContract.test.ts.
const PROJECT_ROOT = resolve(new URL(import.meta.url).pathname, '../../..')

type DocsMarker = {
  // Human-readable contract item — printed in the failure message so an
  // engineer who breaks this test knows what they removed.
  field: string
  // Project-root-relative path to the docs file that MUST mention `field`.
  file: string
  // Substring(s) the file MUST contain. ALL must be present for the row
  // to pass — this is an AND, not an OR.
  mustContain: string[]
}

// Single source of truth for "what does an agent need to find in the
// docs to use the contract correctly". Add a row when adding an agent-
// facing field to the API; delete a row when the field is retired.
const CONTRACT_MARKERS: DocsMarker[] = [
  {
    field: 'POST /deploy/new ?redeploy=true form field (in-place update)',
    file: 'public/llms.txt',
    mustContain: ['redeploy=true', '"redeployed":'],
  },
  {
    field: 'POST /deploy/new ?redeploy=true form field (in-place update)',
    file: 'public/llms-full.txt',
    mustContain: ['redeploy=true', '"redeployed":', 'no_matching_deployment'],
  },
  {
    // TEAM-GATE (2026-06-04 CEO directive): Team is NOT self-serve and must
    // not be described as a public self-serve tier until its unlimited-
    // resource delivery is proven built. Pin the gating wording so a docs
    // revert (or a content-repo sync that still lists Team as self-serve)
    // fails CI. Mirrors the requireMarkers guard in fetch-content.mjs and
    // the PricingPage/ChangePlanModal source changes in this PR.
    // Ref: docs/sessions/2026-06-04/TEAM-PLAN-GATE-AND-BUILD.md.
    field: 'Team tier is sales-assisted, NOT self-serve (CEO gate 2026-06-04)',
    file: 'public/llms.txt',
    mustContain: ['not yet a self-serve tier'],
  },
]

describe('agent docs contract — POST /deploy/new redeploy=true', () => {
  // One it() per registry row so a failure names the file and field.
  for (const row of CONTRACT_MARKERS) {
    it(`${row.file} documents ${row.field}`, () => {
      const path = resolve(PROJECT_ROOT, row.file)
      expect(existsSync(path), `${row.file} does not exist at ${path}`).toBe(true)
      const body = readFileSync(path, 'utf8')
      for (const needle of row.mustContain) {
        // Includes-check, not regex, because the marker strings contain
        // characters (quotes, equals, colons) that would need escaping
        // and the docs are large enough that a regex backtrack on a
        // typo would dominate the failure output. A plain substring
        // miss prints "expected … to include 'redeploy=true'" which is
        // exactly the signal a docs author needs.
        expect(
          body.includes(needle),
          `${row.file}: expected the ${row.field} contract row to include the substring ${JSON.stringify(needle)}. If you intentionally removed this docs surface, also remove the corresponding row from CONTRACT_MARKERS in src/lib/llmsContract.test.ts and link the deprecation PR in the commit message.`
        ).toBe(true)
      }
    })
  }

  it('CONTRACT_MARKERS registry is non-empty (guards against accidental wipeout)', () => {
    // Defensive: if someone ever lands a refactor that empties the
    // registry, this test fails so the for-loop above doesn't silently
    // pass with zero assertions. Per CLAUDE.md rule 18, the registry
    // IS the contract — a deleted row is a deleted promise.
    expect(CONTRACT_MARKERS.length).toBeGreaterThan(0)
  })
})
