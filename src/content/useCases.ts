/* useCases.ts — loader for the /use-cases catalogue.
 *
 * Source of truth: InstaNode-dev/content/use-cases.json, fetched
 * into .content/ at build time by scripts/fetch-content.mjs.
 *
 * Vite handles JSON imports natively (no plugin, no loader); the
 * import.meta.glob form here keeps the load-time pattern identical
 * to posts.ts so a future move to many files (one per case) is a
 * one-line change. Adding a use case = one entry in the JSON file
 * in the content repo. */

export type Service = 'pg' | 'redis' | 'mongo' | 'nats' | 'minio' | 'webhook' | 'deploy'

/* Category is intentionally a plain string. The content repo is the source
 * of truth for what categories exist, so the dashboard should accept
 * anything that lands there. The UseCasesPage renders categories in
 * alphabetical order and uses them as filter-chip labels — no code path
 * needs a closed union. Adding a new category = one entry in
 * use-cases.json; no dashboard PR. */
export type Category = string

export type UseCase = {
  title: string
  category: Category
  scenario: string
  services: Service[]
}

/* Vite inlines the JSON at build time. The glob form returns a map of
 * { path: parsedJson }; we have exactly one file, so flatten. */
const RAW = import.meta.glob('../../.content/use-cases.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown[]>

const ENTRIES = (Object.values(RAW)[0] ?? []) as Array<UseCase | { _comment: string }>

export const USE_CASES: UseCase[] = ENTRIES.filter(
  (e): e is UseCase => !('_comment' in e) && typeof (e as UseCase).title === 'string',
)
