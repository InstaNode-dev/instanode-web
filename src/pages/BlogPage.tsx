/* BlogPage — public /blog index.
 *
 * Lists every post in POSTS (src/content/posts.ts) reverse-chronologically.
 * Each card links to /blog/:slug, rendered by BlogPostPage.
 *
 * Wrapped in PublicShell so the top nav + footer match the rest of the
 * marketing pages. */

import { PublicShell } from '../layout/PublicShell'
import { POSTS } from '../content/posts'

const sorted = [...POSTS].sort((a, b) => b.date.localeCompare(a.date))

export function BlogPage() {
  return (
    <PublicShell>
      <BlogPageStyles />
      <div className="blog-wrap">
        <header className="blog-hero">
          <h1>Blog</h1>
          <p className="blog-sub">
            Build notes, retrospectives, and the occasional rant on what
            "frictionless for AI agents" actually means.
          </p>
        </header>

        <ul className="blog-list" aria-label="Posts">
          {sorted.map((p) => (
            <li key={p.slug} className="blog-card">
              <a href={`/blog/${p.slug}`} className="blog-card-link">
                <time dateTime={p.date} className="blog-card-date">
                  {formatDate(p.date)}
                </time>
                <h2 className="blog-card-title">{p.title}</h2>
                <p className="blog-card-excerpt">{p.excerpt}</p>
                <span className="blog-card-cta">Read post →</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </PublicShell>
  )
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function BlogPageStyles() {
  return (
    <style>{`
      .blog-wrap { max-width: 760px; margin: 0 auto; padding: 56px 24px 80px; }
      .blog-hero h1 { font-size: 40px; margin: 0 0 12px; letter-spacing: -0.02em; }
      .blog-sub { color: var(--text-muted, #6b7280); font-size: 18px; line-height: 1.5; margin: 0 0 48px; }
      .blog-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 16px; }
      .blog-card { border: 1px solid var(--border, #e5e7eb); border-radius: 12px; transition: border-color 120ms; }
      .blog-card:hover { border-color: var(--accent, #3b82f6); }
      .blog-card-link { display: block; padding: 24px; text-decoration: none; color: inherit; }
      .blog-card-date { color: var(--text-muted, #6b7280); font-size: 14px; font-variant-numeric: tabular-nums; }
      .blog-card-title { font-size: 22px; margin: 8px 0 12px; letter-spacing: -0.01em; }
      .blog-card-excerpt { color: var(--text-muted, #4b5563); line-height: 1.55; margin: 0 0 16px; }
      .blog-card-cta { color: var(--accent, #3b82f6); font-size: 14px; font-weight: 500; }
    `}</style>
  )
}
