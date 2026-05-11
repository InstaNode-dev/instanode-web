/* posts.ts — loader for blog post content.
 *
 * Source of truth: InstaNode-dev/content repo, blog/<slug>.md files.
 * Cloned into .content/ at build time by scripts/fetch-content.mjs;
 * Vite's import.meta.glob inlines the raw markdown into the bundle.
 *
 * Shape of each .md file:
 *
 *   ---
 *   title: ...
 *   date: YYYY-MM-DD
 *   author: ...
 *   excerpt: one-line summary
 *   ---
 *
 *   # Heading
 *
 *   Body...
 *
 * The slug for each post is its filename without the .md extension. */

export type Post = {
  slug: string
  title: string
  date: string
  author: string
  excerpt: string
  body: string
}

const RAW_POSTS = import.meta.glob('../../.content/blog/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

export const POSTS: Post[] = Object.entries(RAW_POSTS)
  .map(([path, src]) => buildPost(path, src))
  .filter((p): p is Post => p !== null)
  .sort((a, b) => b.date.localeCompare(a.date))

function buildPost(path: string, src: string): Post | null {
  const filename = path.split('/').pop()
  if (!filename) return null
  const slug = filename.replace(/\.md$/, '')

  const { meta, body } = parseFrontmatter(src)
  if (!meta.title || !meta.date) return null

  return {
    slug,
    title: meta.title,
    date: meta.date,
    author: meta.author || 'instanode.dev',
    excerpt: meta.excerpt || '',
    body: body.trim(),
  }
}

/* parseFrontmatter — tiny YAML subset for blog post headers.
 *
 * Supports single-line `key: value` pairs only. No block scalars, no
 * arrays, no nesting. The content repo's README pins this contract;
 * any post that wants richer structure should put it in the body. */
function parseFrontmatter(src: string): { meta: Record<string, string>; body: string } {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { meta: {}, body: src }
  const meta: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const sep = line.indexOf(':')
    if (sep < 0) continue
    const key = line.slice(0, sep).trim()
    const value = line.slice(sep + 1).trim()
    if (key) meta[key] = value
  }
  return { meta, body: m[2] }
}
