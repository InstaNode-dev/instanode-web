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
 * public domain.
 *
 * Wave 3 additions (2026-05-21):
 *   - B3-P2-3: client-side fuzzy search across all sections via fuse.js.
 *     The search index is built once at module load from frontmatter
 *     titles + section bodies. Matches scroll the page to the anchor.
 *   - B3-P2-5: mobile sidebar collapses below 768px behind a button.
 *     Above 768px the sidebar is always-visible (no JS state needed).
 *   - B3-P2-6: "Edit on GitHub" link per section pointing at the
 *     content-repo raw markdown source — readers fixing a typo can land
 *     on the source file directly. */

import { useEffect, useMemo, useRef, useState } from 'react'
import Fuse from 'fuse.js'
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

// GitHub raw source path. The content lives in InstaNode-dev/content
// on `main` under docs/<id>.md. Construct the human-facing GitHub URL
// (the "blob" view, not the raw view) so the reader lands on the
// rendered file with the "Edit this file" pencil one click away.
const CONTENT_REPO = 'InstaNode-dev/content'
const CONTENT_BRANCH = 'main'
const editOnGithubUrl = (sectionId: string): string =>
  `https://github.com/${CONTENT_REPO}/edit/${CONTENT_BRANCH}/docs/${sectionId}.md`

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
      <DocsBody />
    </PublicShell>
  )
}

/* DocsBody — extracted from DocsPage so the search + sidebar-state
 * hooks live below the PublicShell boundary. Keeps the page wrapper
 * SSR-clean. */
function DocsBody() {
  const [query, setQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Build the search index once. The corpus is small (≤20 sections,
  // a few KB each) so Fuse is more than fast enough — no debounce.
  const fuse = useMemo(
    () =>
      new Fuse(SECTIONS, {
        keys: [
          { name: 'title', weight: 2 },
          { name: 'body', weight: 1 },
        ],
        threshold: 0.4,
        includeMatches: false,
        ignoreLocation: true,
        minMatchCharLength: 2,
      }),
    []
  )

  const results = useMemo(() => {
    const q = query.trim()
    if (!q) return null
    return fuse.search(q).slice(0, 10).map((r) => r.item)
  }, [fuse, query])

  // `/` shortcut focuses the search box (provided the user isn't
  // already typing in an input). Common convention on docs sites
  // (Stripe, Linear, Vercel).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName ?? ''
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const closeSidebar = () => setSidebarOpen(false)

  return (
    <div className="docs-wrap">
      <button
        type="button"
        className="docs-sidebar-toggle"
        aria-expanded={sidebarOpen}
        aria-controls="docs-sidebar"
        onClick={() => setSidebarOpen((v) => !v)}
      >
        <span aria-hidden="true">≡</span> {sidebarOpen ? 'Hide' : 'Show'} sections
      </button>

      <aside
        id="docs-sidebar"
        className={`docs-toc ${sidebarOpen ? 'open' : ''}`}
        aria-label="Documentation sections"
      >
        <p className="docs-toc-label">Docs</p>

        <div className="docs-search">
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search docs…"
            aria-label="Search documentation"
            className="docs-search-input"
          />
          <kbd className="docs-search-kbd" aria-hidden="true">/</kbd>
        </div>

        {results ? (
          <ol className="docs-toc-results">
            {results.length === 0 ? (
              <li className="docs-toc-empty">No matches.</li>
            ) : (
              results.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} onClick={closeSidebar}>
                    {s.title}
                  </a>
                </li>
              ))
            )}
          </ol>
        ) : (
          <ol>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} onClick={closeSidebar}>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        )}

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
              <a
                href={editOnGithubUrl(s.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="docs-section-edit"
                aria-label={`Edit “${s.title}” on GitHub`}
              >
                Edit on GitHub ↗
              </a>
            </h2>
            <div className="docs-section-body">
              {renderMarkdown(s.body, { baseHeading: 'h3', keyPrefix: s.id })}
            </div>
          </section>
        ))}
      </article>
    </div>
  )
}

function DocsStyles() {
  return (
    <style>{`
      .docs-wrap { max-width: 1080px; margin: 0 auto; padding: 40px 24px 80px; display: grid; grid-template-columns: 220px 1fr; gap: 48px; }

      /* sidebar toggle button — hidden on desktop */
      .docs-sidebar-toggle {
        display: none;
        align-items: center; gap: 8px;
        padding: 8px 14px;
        background: var(--ink);
        border: 1px solid var(--border-hi);
        border-radius: 6px;
        color: var(--text);
        font-size: 13px;
        cursor: pointer;
        margin-bottom: 16px;
        align-self: start;
        grid-column: 1;
      }
      .docs-sidebar-toggle:hover { border-color: var(--accent); }
      .docs-sidebar-toggle span { font-size: 16px; line-height: 1; }

      .docs-toc { position: sticky; top: 88px; align-self: start; font-size: 14px; }
      .docs-toc-label { color: var(--text-dim); margin: 0 0 12px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
      .docs-toc ol { list-style: none; padding: 0; margin: 0 0 24px; display: grid; gap: 4px; }
      .docs-toc a { color: var(--text-dim); text-decoration: none; padding: 4px 0; display: block; }
      .docs-toc a:hover { color: var(--accent); }
      .docs-toc-foot { font-size: 13px; color: var(--text-dim); }
      .docs-toc-foot a { color: var(--accent); }
      .docs-toc-empty { color: var(--text-faint); font-style: italic; font-size: 13px; }

      /* search box */
      .docs-search {
        position: relative;
        margin: 0 0 16px;
      }
      .docs-search-input {
        width: 100%;
        padding: 7px 28px 7px 10px;
        background: var(--ink);
        border: 1px solid var(--border-hi);
        border-radius: 6px;
        color: var(--text);
        font-family: var(--font-mono);
        font-size: 12.5px;
        outline: 0;
        box-sizing: border-box;
      }
      .docs-search-input::placeholder { color: var(--text-faint); }
      .docs-search-input:focus { border-color: var(--accent); }
      .docs-search-kbd {
        position: absolute;
        right: 6px; top: 50%;
        transform: translateY(-50%);
        font-family: var(--font-mono);
        font-size: 10.5px;
        padding: 1px 5px;
        background: var(--surface);
        border: 1px solid var(--border-hi);
        color: var(--text-dim);
        border-radius: 3px;
        pointer-events: none;
      }
      .docs-toc-results {
        border-top: 1px dashed var(--border);
        padding-top: 10px !important;
        margin-top: -4px !important;
      }

      .docs-main { min-width: 0; }
      .docs-hero h1 { font-size: 40px; margin: 0 0 12px; letter-spacing: -0.02em; }
      .docs-hero p { color: var(--text-dim); font-size: 18px; line-height: 1.5; margin: 0 0 48px; }
      .docs-section { margin: 0 0 56px; }
      .docs-section h2 {
        font-size: 26px; margin: 0 0 16px; letter-spacing: -0.015em;
        display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
      }
      .docs-section-anchor { color: inherit; text-decoration: none; }
      .docs-section-anchor:hover::before { content: '# '; color: var(--accent); }
      .docs-section-edit {
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--text-faint);
        text-decoration: none;
        padding: 2px 8px;
        border: 1px solid var(--border);
        border-radius: 4px;
        transition: color 120ms, border-color 120ms;
        align-self: center;
      }
      .docs-section-edit:hover { color: var(--accent); border-color: var(--accent); }
      .docs-section-body { font-size: 16px; line-height: 1.65; color: var(--text); }
      .docs-section-body h3 { font-size: 18px; margin: 28px 0 8px; }
      .docs-section-body p { margin: 0 0 16px; }
      .docs-section-body ul { margin: 0 0 16px; padding-left: 24px; }
      .docs-section-body li { margin: 6px 0; }
      .docs-section-body code { background: var(--ink); border: 1px solid var(--border); color: var(--text); padding: 1px 6px; border-radius: 4px; font-size: 13.5px; font-family: var(--font-mono); }
      .docs-section-body pre { background: var(--code-bg); color: var(--text); border: 1px solid var(--border); padding: 16px 20px; border-radius: 8px; overflow-x: auto; font-size: 13px; line-height: 1.55; margin: 16px 0; }
      .docs-section-body pre code { background: transparent; padding: 0; color: inherit; }
      .docs-section-body pre.md-table { background: transparent; color: inherit; padding: 0; font-size: 14px; }
      .docs-section-body strong { font-weight: 600; }

      /* mobile sidebar collapse — 768px is the agreed dashboard
         break, matching the rest of the marketing CSS. */
      @media (max-width: 768px) {
        .docs-wrap {
          grid-template-columns: 1fr;
          gap: 16px;
          padding: 24px 18px 64px;
        }
        .docs-sidebar-toggle { display: inline-flex; }
        .docs-toc {
          position: static;
          display: none;
          padding: 14px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--surface);
        }
        .docs-toc.open { display: block; }
        .docs-section h2 { font-size: 22px; }
      }
    `}</style>
  )
}
