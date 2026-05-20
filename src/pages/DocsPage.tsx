/* DocsPage — public /docs.
 *
 * Single-page docs with a sidebar TOC and section anchors. Content lives
 * in InstaNode-dev/content/docs/<id>.md, cloned into .content/ at build
 * time. Adding/removing a section = one .md file in the content repo;
 * no dashboard PR.
 *
 * Section ordering comes from `order:` frontmatter (numeric).
 * Section anchor id = filename minus .md.
 *
 * Security note: every code snippet here is reachable by anyone curling
 * the public domain — they are all anonymous-tier paths. Do not paste
 * production JWTs, internal cluster hostnames (*.svc.cluster.local),
 * team_ids, or AES/JWT secrets into snippets. The docs ship to the
 * public domain. */

import { PublicShell } from '../layout/PublicShell'
import { renderMarkdown } from '../lib/markdown'

type Section = {
  id: string
  title: string
  body: string // same minimal markdown subset as blog posts
}

const RAW_DOCS = import.meta.glob('../../.content/docs/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const SECTIONS: Section[] = buildSections(RAW_DOCS)

function buildSections(raw: Record<string, string>): Section[] {
  return Object.entries(raw)
    .map(([path, src]) => {
      const id = path.split('/').pop()!.replace(/\.md$/, '')
      const { meta, body } = parseFrontmatter(src)
      if (!meta.title) return null
      return { id, title: meta.title, body: body.trim(), order: Number(meta.order) || 0 }
    })
    .filter((s): s is Section & { order: number } => s !== null)
    .sort((a, b) => a.order - b.order)
    .map(({ order: _, ...section }) => section)
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

// Unused legacy inline content removed — sections now load from .content/docs/.

export function DocsPage() {
  return (
    <PublicShell>
      <DocsStyles />
      <div className="docs-wrap">
        <aside className="docs-toc" aria-label="Documentation sections">
          <p className="docs-toc-label">Docs</p>
          <ol>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
          </ol>
          <p className="docs-toc-foot">
            Full API ref:{' '}
            <a href="https://api.instanode.dev/openapi.json" target="_blank" rel="noopener noreferrer">
              openapi.json ↗
            </a>
          </p>
        </aside>

        <article className="docs-main">
          <header className="docs-hero">
            <h1>Documentation</h1>
            <p>Everything you need to provision, deploy, and claim. Every curl below works as-is.</p>
          </header>

          {SECTIONS.map((s) => (
            <section key={s.id} id={s.id} className="docs-section">
              <h2>
                <a href={`#${s.id}`} className="docs-section-anchor">
                  {s.title}
                </a>
              </h2>
              <div className="docs-section-body">
                {renderMarkdown(s.body, { baseHeading: 'h3', keyPrefix: s.id })}
              </div>
            </section>
          ))}
        </article>
      </div>
    </PublicShell>
  )
}

function DocsStyles() {
  return (
    <style>{`
      .docs-wrap { max-width: 1080px; margin: 0 auto; padding: 40px 24px 80px; display: grid; grid-template-columns: 220px 1fr; gap: 48px; }
      @media (max-width: 760px) { .docs-wrap { grid-template-columns: 1fr; } .docs-toc { position: static; } }
      .docs-toc { position: sticky; top: 88px; align-self: start; font-size: 14px; }
      .docs-toc-label { color: var(--text-dim); margin: 0 0 12px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
      .docs-toc ol { list-style: none; padding: 0; margin: 0 0 24px; display: grid; gap: 4px; }
      .docs-toc a { color: var(--text-dim); text-decoration: none; padding: 4px 0; display: block; }
      .docs-toc a:hover { color: var(--accent); }
      .docs-toc-foot { font-size: 13px; color: var(--text-dim); }
      .docs-toc-foot a { color: var(--accent); }
      .docs-main { min-width: 0; }
      .docs-hero h1 { font-size: 40px; margin: 0 0 12px; letter-spacing: -0.02em; }
      .docs-hero p { color: var(--text-dim); font-size: 18px; line-height: 1.5; margin: 0 0 48px; }
      .docs-section { margin: 0 0 56px; }
      .docs-section h2 { font-size: 26px; margin: 0 0 16px; letter-spacing: -0.015em; }
      .docs-section-anchor { color: inherit; text-decoration: none; }
      .docs-section-anchor:hover::before { content: '# '; color: var(--accent); }
      .docs-section-body { font-size: 16px; line-height: 1.65; color: var(--text); }
      .docs-section-body h3 { font-size: 18px; margin: 28px 0 8px; }
      .docs-section-body p { margin: 0 0 16px; }
      .docs-section-body ul { margin: 0 0 16px; padding-left: 24px; }
      .docs-section-body li { margin: 6px 0; }
      .docs-section-body code { background: var(--ink); border: 1px solid var(--border); color: var(--text); padding: 1px 6px; border-radius: 4px; font-size: 13.5px; font-family: var(--font-mono); }
      .docs-section-body pre { background: var(--code-bg); color: var(--text); border: 1px solid var(--border); padding: 16px 20px; border-radius: 8px; overflow-x: auto; font-size: 13px; line-height: 1.55; margin: 16px 0; }
      /* Reserve top padding for the Copy button + language pill on
         fenced code blocks (CodeBlock component). The .md-table fallback
         doesn't need the headroom — it's a plain ASCII grid. */
      .docs-section-body pre.code-block { padding-top: 32px; }
      .docs-section-body pre code { background: transparent; padding: 0; color: inherit; }
      .docs-section-body pre.md-table { background: transparent; color: inherit; padding: 0; font-size: 14px; }
      .docs-section-body strong { font-weight: 600; }
    `}</style>
  )
}
