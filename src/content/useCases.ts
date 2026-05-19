/* useCases.ts — loader for the /use-cases catalogue.
 *
 * Source of truth: InstaNode-dev/content/use-cases/<slug>.md, cloned
 * into .content/ at build time. Each file is a markdown document with
 * YAML frontmatter:
 *
 *   ---
 *   title: ...
 *   category: ...
 *   services: ["pg", "redis"]   # JSON-array syntax for arrays
 *   scenario: ...
 *   ---
 *
 *   (optional body: hand-authored "How to do it" / "Why this is useful")
 *
 * The slug is the filename without `.md`. Adding a use case = one
 * markdown file in the content repo; no dashboard PR.
 *
 * Service is a closed union (platform-defined). Category is a plain
 * string (content-defined). See PR #13 for the category type history. */

/* SERVICES is the single source of truth for valid service identifiers.
 * The Service type is derived from it so the runtime allow-list (used by
 * parseServices to reject unknown frontmatter values) and the compile-time
 * type can never drift. SERVICE_INFO in UseCaseDetailPage is keyed by this. */
export const SERVICES = ['pg', 'redis', 'mongo', 'nats', 'minio', 'webhook', 'deploy'] as const
export type Service = (typeof SERVICES)[number]
export type Category = string

export type UseCase = {
  slug: string
  title: string
  category: Category
  scenario: string
  services: Service[]
  body: string // "" if no hand-authored detail content yet
}

const RAW = import.meta.glob('../../.content/use-cases/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

export const USE_CASES: UseCase[] = Object.entries(RAW)
  .map(([path, src]) => buildCase(path, src))
  .filter((c): c is UseCase => c !== null)
  .sort((a, b) => a.title.localeCompare(b.title))

export function getUseCaseBySlug(slug: string): UseCase | undefined {
  return USE_CASES.find((c) => c.slug === slug)
}

function buildCase(path: string, src: string): UseCase | null {
  const filename = path.split('/').pop()
  if (!filename) return null
  const slug = filename.replace(/\.md$/, '')

  const { meta, body } = parseFrontmatter(src)
  if (!meta.title || !meta.category || !meta.scenario) return null

  return {
    slug,
    title: meta.title,
    category: meta.category,
    scenario: meta.scenario,
    services: parseServices(meta.services),
    body: body.trim(),
  }
}

/* isService — runtime guard against the SERVICES allow-list. The use-case
 * .md files are fetched from the external `content` repo, so an unknown or
 * misspelled identifier (e.g. "storage" instead of "minio") can appear in
 * frontmatter. Such a value must NOT reach SERVICE_INFO[...] — that lookup
 * returns undefined and crashes the prerender build. */
function isService(s: unknown): s is Service {
  return typeof s === 'string' && (SERVICES as readonly string[]).includes(s)
}

/* parseServices — accepts JSON-array syntax in frontmatter, e.g.
 *   services: ["pg", "redis"]
 * Anything that doesn't parse as an array becomes []; entries that are not
 * a known Service (see isService) are dropped rather than cast through.
 * Exported for regression testing — see useCases.test.ts. */
export function parseServices(raw: string | undefined): Service[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isService)
  } catch {
    return []
  }
}

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
