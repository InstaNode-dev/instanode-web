/* fetch-content.mjs — pulls public marketing content from InstaNode-dev/content.
 *
 * Why this exists: blog posts, use cases, and (later) /docs page content
 * live in a separate public repo so non-engineers can edit prose without
 * touching the React app. The repo is cloned into dashboard/.content/
 * before every `vite build` and `vite dev` — Vite's import.meta.glob
 * picks up the markdown files at build time and inlines them into the
 * bundle. No runtime fetch, no CMS.
 *
 * Failure modes:
 *  - Clone fails (offline, repo deleted): if .content/ already exists,
 *    warn and proceed with stale content. If not, exit 1 so build fails
 *    visibly rather than rendering an empty /blog page.
 *  - Pull fails on a stale clone: same as above — keep the stale clone,
 *    warn, proceed. Better to ship yesterday's content than nothing.
 *
 * Override the source repo for forks / staging by setting:
 *   INSTANODE_CONTENT_REPO_URL  default: https://github.com/InstaNode-dev/content.git
 *   INSTANODE_CONTENT_BRANCH    default: main
 */

import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TARGET = resolve(ROOT, '.content')

const REPO = process.env.INSTANODE_CONTENT_REPO_URL || 'https://github.com/InstaNode-dev/content.git'
const BRANCH = process.env.INSTANODE_CONTENT_BRANCH || 'main'

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

console.log('fetch-content: done.')
