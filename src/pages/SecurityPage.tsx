/* SecurityPage — public /security.
 *
 * Before this page existed, PublicShell's footer linked to
 *   /docs/public/security.md
 * which GitHub Pages served as `Content-Type: text/markdown` — a raw
 * unrendered markdown file. A visitor clicking "Security" from the
 * footer saw the literal `## Reporting a vulnerability` source with no
 * formatting, a confusing experience that also broke the assumption
 * that public legal docs are real HTML pages with the standard chrome.
 *
 * This page imports the same security.md from public/docs/public/ via
 * Vite's import.meta.glob (raw text) and renders it through the shared
 * minimal markdown pipeline. The footer link now points to /security
 * (a real route), and the .md file stays available at the original URL
 * for any direct linker — same content, two surfaces, no duplication.
 *
 * The four other legal docs (DPA, subprocessors, trust-residency,
 * breach-notification) follow the same pattern via the `LEGAL_DOCS`
 * map below; adding /privacy-doc, /trust, etc. is a one-line edit. */

import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { PublicShell } from '../layout/PublicShell'
import { renderMarkdown } from '../lib/markdown'

// LEGAL_DOCS — eager raw imports of every public-facing legal markdown
// file. Keys are the URL slug under /docs/public/, values are the raw
// markdown source. Vite resolves these at build time so the bundle
// inlines the bytes; no runtime fetch needed. Adding a new legal doc
// is one PR to public/docs/public/<slug>.md plus one route below.
const LEGAL_DOCS = import.meta.glob('../../public/docs/public/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

/** docBySlug — looks up the raw markdown body for a slug under
 * /docs/public. Returns null if the file isn't in the glob (e.g. a
 * mistyped URL). */
function docBySlug(slug: string): string | null {
  for (const [path, body] of Object.entries(LEGAL_DOCS)) {
    if (path.endsWith(`/${slug}.md`)) return body
  }
  return null
}

const TITLES: Record<string, string> = {
  security: 'Security Disclosures',
  dpa: 'Data Processing Agreement',
  subprocessors: 'Subprocessors',
  'trust-residency': 'Trust & Residency',
  'breach-notification': 'Breach Notification Policy',
}

/** SecurityPage — the dedicated /security route. Wraps the shared
 * LegalDocBody so the footer "Security" link routes directly here
 * without exposing the slug-based machinery to the consumer. */
export function SecurityPage() {
  return <LegalDocBody slug="security" />
}

/** LegalDocPage — generic /legal/:slug route for the other public
 * legal docs (DPA, subprocessors, etc.). Reads useParams() to pick the
 * doc; if the slug doesn't match a known file the page renders a
 * friendly fallback (still inside PublicShell so the visitor can get
 * back to the homepage). */
export function LegalDocPage() {
  const { slug = '' } = useParams<{ slug?: string }>()
  return <LegalDocBody slug={slug} />
}

function LegalDocBody({ slug }: { slug: string }) {
  const body = useMemo(() => docBySlug(slug), [slug])
  const title = TITLES[slug] ?? 'Document'

  return (
    <PublicShell>
      <LegalDocStyles />
      <article className="legal-wrap">
        <header className="legal-hero">
          <a href="/" className="legal-back" aria-label="Back to homepage">
            ← instanode.dev
          </a>
          <h1>{title}</h1>
          <p className="legal-sub">
            Raw source:{' '}
            <a href={`/docs/public/${slug}.md`} target="_blank" rel="noopener noreferrer">
              /docs/public/{slug}.md
            </a>
          </p>
        </header>
        <section className="legal-body">
          {body ? (
            renderMarkdown(stripFrontmatter(body), { baseHeading: 'h2', keyPrefix: slug })
          ) : (
            <p>
              We couldn't find a legal document at <code>/legal/{slug}</code>.{' '}
              <a href="/">Back to the homepage</a>.
            </p>
          )}
        </section>
      </article>
    </PublicShell>
  )
}

/** stripFrontmatter — the legal markdown files don't currently use YAML
 * frontmatter, but if a future author adds one (e.g. for `last_updated`)
 * we don't want it to render as the first paragraph. Symmetric with the
 * parser in DocsPage and the BlogPostPage renderer. */
function stripFrontmatter(src: string): string {
  return src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
}

function LegalDocStyles() {
  return (
    <style>{`
      .legal-wrap {
        max-width: 760px;
        margin: 0 auto;
        padding: 64px 24px 96px;
      }
      .legal-hero { margin: 0 0 32px; }
      .legal-back {
        display: inline-block;
        margin-bottom: 16px;
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--text-dim, #888);
        text-decoration: none;
      }
      .legal-back:hover { color: var(--text, #fff); }
      .legal-hero h1 {
        font-family: var(--font-display, inherit);
        font-size: clamp(28px, 4vw, 40px);
        line-height: 1.1;
        letter-spacing: -0.02em;
        margin: 0 0 8px;
      }
      .legal-sub {
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--text-dim, #888);
        margin: 0;
      }
      .legal-sub a {
        color: var(--text-dim, #888);
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .legal-body {
        font-size: 15px;
        line-height: 1.65;
        color: var(--text, #ddd);
      }
      .legal-body h2 {
        font-family: var(--font-display, inherit);
        font-size: 22px;
        line-height: 1.25;
        margin: 40px 0 12px;
        color: var(--text, #fff);
      }
      .legal-body h3 {
        font-size: 17px;
        margin: 28px 0 10px;
        color: var(--text, #fff);
      }
      .legal-body h4 {
        font-size: 15px;
        margin: 22px 0 8px;
        color: var(--text, #fff);
      }
      .legal-body p { margin: 0 0 16px; }
      .legal-body ul, .legal-body ol { margin: 0 0 16px 24px; padding: 0; }
      .legal-body li { margin: 0 0 6px; }
      .legal-body code {
        font-family: var(--font-mono);
        font-size: 0.9em;
        padding: 1px 5px;
        border-radius: 3px;
        background: var(--surface, #1a1a1a);
        border: 1px solid var(--border, #2a2a2a);
      }
      .legal-body pre {
        background: var(--surface, #1a1a1a);
        border: 1px solid var(--border, #2a2a2a);
        border-radius: 6px;
        padding: 12px 14px;
        overflow-x: auto;
        font-size: 12px;
        margin: 0 0 16px;
      }
      .legal-body pre code { background: transparent; border: none; padding: 0; }
      .legal-body blockquote {
        border-left: 3px solid var(--accent, #9b87f5);
        padding-left: 14px;
        color: var(--text-muted, #aaa);
        margin: 16px 0;
      }
      .legal-body a {
        color: var(--text, #fff);
        text-decoration: underline;
        text-decoration-color: var(--text-dim, #555);
        text-underline-offset: 3px;
      }
      .legal-body a:hover { text-decoration-color: var(--accent, #9b87f5); }
    `}</style>
  )
}
