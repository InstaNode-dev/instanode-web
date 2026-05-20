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
import { copyFileSync, existsSync } from 'fs'
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
const SYNC_FILES = [
  { src: 'llms.txt', dest: 'public/llms.txt' },
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
for (const { src, dest } of SYNC_FILES) {
  const srcPath = resolve(TARGET, src)
  const destPath = resolve(ROOT, dest)
  if (!existsSync(srcPath)) {
    console.warn(`fetch-content: WARNING — ${src} missing from .content/; leaving ${dest} as-is.`)
    continue
  }
  copyFileSync(srcPath, destPath)
  console.log(`fetch-content: synced .content/${src} → ${dest}`)
}

console.log('fetch-content: done.')
