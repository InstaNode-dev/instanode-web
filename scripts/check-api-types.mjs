/* check-api-types.mjs — up-to-date gate for the generated API types.
 *
 * Wave 1 contract-drift gate (docs/ci/01-CI-INTEGRATION-DESIGN.md). Mirrors how
 * the api repo gates openapi.snapshot.json: regenerate src/api/generated.ts from
 * the committed openapi.snapshot.json and FAIL if the committed file differs.
 *
 * Why: src/api/generated.ts is the openapi-typescript output that the wire types
 * in src/api/types.ts derive from. If someone updates openapi.snapshot.json (the
 * api contract) but forgets to regenerate generated.ts, the UI's derived types
 * would silently lag the contract — defeating the whole gate. This check makes
 * that lag a CI failure with the exact fix command.
 *
 * The api->web snapshot sync itself is a committed copy
 * (instanode-web/openapi.snapshot.json, synced from the api repo's
 * openapi.snapshot.json). Cross-repo verification at CI time is intentionally
 * NOT attempted here (CI must not depend on the api repo being checked out or on
 * prod being up) — the copy is committed for determinism and re-synced when the
 * api contract changes (see docs note). This check only guarantees generated.ts
 * is faithful to whatever snapshot copy is committed.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SNAPSHOT = './openapi.snapshot.json'
const COMMITTED = './src/api/generated.ts'

const tmp = mkdtempSync(join(tmpdir(), 'gen-api-types-'))
const regenerated = join(tmp, 'generated.ts')

try {
  // Regenerate into a temp file using the same tool/version as `gen:api-types`.
  execFileSync(
    'npx',
    ['openapi-typescript', SNAPSHOT, '-o', regenerated],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )

  const committed = readFileSync(COMMITTED, 'utf8')
  const fresh = readFileSync(regenerated, 'utf8')

  if (committed !== fresh) {
    console.error(
      '\n✗ src/api/generated.ts is OUT OF DATE with openapi.snapshot.json.\n' +
        '  The committed generated API types do not match what `openapi-typescript`\n' +
        '  produces from the current snapshot. Run:\n\n' +
        '      npm run gen:api-types\n\n' +
        '  and commit the updated src/api/generated.ts in this PR.\n' +
        '  (Wave 1 contract-drift gate — docs/ci/01-CI-INTEGRATION-DESIGN.md.)\n',
    )
    process.exit(1)
  }

  console.log('✓ src/api/generated.ts is up to date with openapi.snapshot.json.')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
