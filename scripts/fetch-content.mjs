/* fetch-content.mjs — pulls public marketing content from InstaNode-dev/content.
 *
 * Why this exists: blog posts, use cases, /docs page content, and the
 * /llms.txt agent contract manifest live in a separate public repo so
 * non-engineers can edit prose without touching the React app. The repo
 * is cloned into instanode-web/.content/ before every `vite build` and
 * `vite dev` — Vite's import.meta.glob picks up the markdown files at
 * build time and inlines them into the bundle. No runtime fetch, no CMS.
 *
 * /llms.txt sync (2026-05-20, closes Open Design Gap #0 in CLAUDE.md):
 * The `content` repo has NO auto-deploy of its own; this script + the
 * instanode-web build pipeline is the only path that gets `llms.txt` to
 * prod. After cloning, we copy `.content/llms.txt` → `public/llms.txt`
 * so Vite's static-asset pipeline serves it at the apex
 * (https://instanode.dev/llms.txt). Without this copy, the committed
 * `public/llms.txt` ages out vs `content` HEAD any time content prose
 * changes — which is the exact stale-contract bug agents hit.
 *
 * Failure modes:
 *  - Clone fails (offline, repo deleted): if .content/ already exists,
 *    warn and proceed with stale content. If not, exit 1 so build fails
 *    visibly rather than rendering an empty /blog page.
 *  - Pull fails on a stale clone: same as above — keep the stale clone,
 *    warn, proceed. Better to ship yesterday's content than nothing.
 *  - llms.txt missing from .content/: warn and proceed. The committed
 *    public/llms.txt acts as a stale-but-present fallback so the route
 *    never 404s.
 *
 * Override the source repo for forks / staging by setting:
 *   INSTANODE_CONTENT_REPO_URL  default: https://github.com/InstaNode-dev/content.git
 *   INSTANODE_CONTENT_BRANCH    default: main
 */

import { execSync } from 'child_process'
import { copyFileSync, existsSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TARGET = resolve(ROOT, '.content')

const REPO = process.env.INSTANODE_CONTENT_REPO_URL || 'https://github.com/InstaNode-dev/content.git'
const BRANCH = process.env.INSTANODE_CONTENT_BRANCH || 'main'

// Files synced verbatim from .content/<src> → instanode-web/<dest> on every
// build. Add new top-level content files here; nested trees (blog/, docs/,
// use-cases/, pages/) are consumed via import.meta.glob at build time and
// don't need an explicit copy.
//
// `requireMarkers` (optional): if set, the destination file is OVERWRITTEN
// from `.content/<src>` only when the upstream copy already contains every
// listed substring. If any marker is missing upstream, the existing
// committed `dest` file is preserved instead, with a WARNING line. This is
// the cross-repo lock-step guard for contract drift: when a new agent-
// facing field is documented in `instanode-web/public/llms.txt` ahead of
// its mirror landing in the content repo, the build does NOT silently
// revert the documentation to the stale upstream version (which would
// break tests in src/lib/llmsContract.test.ts and lie to agents reading
// the live `https://instanode.dev/llms.txt`). Once the content-repo PR
// lands, both copies will diverge in lockstep and the guard becomes a
// no-op. See PR `docs/deploy-new-redeploy-param`.
const SYNC_FILES = [
  {
    src: 'llms.txt',
    dest: 'public/llms.txt',
    // Markers MUST be kept in sync with the assertions in
    // src/lib/llmsContract.test.ts — see rule 18 (registry-iterating
    // regression test) and rule 22 (contract changes touch all surfaces).
    //
    // TEAM-GATE (2026-06-04 CEO directive): the 'not yet a self-serve tier'
    // marker guards the Team-tier gating copy. If an upstream content-repo
    // sync ever drops the gating (reverting Team to a public self-serve
    // tier), this PRESERVES the committed public/llms.txt so the build can't
    // silently re-market Team as buyable. The content repo currently carries
    // the same wording, so the guard is a no-op today.
    requireMarkers: ['redeploy=true', '"redeployed":', 'not yet a self-serve tier'],
  },
]

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'inherit', ...opts })
}

function tryRun(cmd, opts = {}) {
  try {
    run(cmd, opts)
    return true
  } catch {
    return false
  }
}

if (existsSync(TARGET)) {
  console.log(`fetch-content: updating ${TARGET} from ${REPO} (${BRANCH})…`)
  const fetched = tryRun(`git fetch --quiet --depth=1 origin ${BRANCH}`, { cwd: TARGET })
  if (!fetched) {
    console.warn('fetch-content: WARNING — git fetch failed (offline?). Using existing .content/.')
  } else {
    tryRun(`git reset --quiet --hard origin/${BRANCH}`, { cwd: TARGET })
  }
} else {
  console.log(`fetch-content: cloning ${REPO} (${BRANCH}) into ${TARGET}…`)
  const ok = tryRun(`git clone --quiet --depth=1 --branch=${BRANCH} ${REPO} ${TARGET}`)
  if (!ok) {
    console.error(`fetch-content: FATAL — clone of ${REPO} failed and no cached .content/ exists.`)
    console.error('Cannot build: blog/use-cases content is unavailable. Aborting.')
    process.exit(1)
  }
}

// Sync top-level content files (e.g. llms.txt) into instanode-web so
// Vite's static pipeline serves them at the apex on the next build.
for (const { src, dest, requireMarkers } of SYNC_FILES) {
  const srcPath = resolve(TARGET, src)
  const destPath = resolve(ROOT, dest)
  if (!existsSync(srcPath)) {
    console.warn(`fetch-content: WARNING — ${src} missing from .content/; leaving ${dest} as-is.`)
    continue
  }
  if (requireMarkers && requireMarkers.length > 0) {
    const upstream = readFileSync(srcPath, 'utf8')
    const missing = requireMarkers.filter((m) => !upstream.includes(m))
    if (missing.length > 0) {
      console.warn(
        `fetch-content: WARNING — upstream .content/${src} is missing required markers ${JSON.stringify(missing)}; PRESERVING the committed ${dest} (likely a contract update that has not yet landed in the content repo). Land the content-repo PR to clear this warning.`
      )
      continue
    }
  }
  copyFileSync(srcPath, destPath)
  console.log(`fetch-content: synced .content/${src} → ${dest}`)
}

console.log('fetch-content: done.')
