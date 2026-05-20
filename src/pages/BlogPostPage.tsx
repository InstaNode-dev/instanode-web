/* BlogPostPage — public /blog/:slug detail.
 *
 * Renders a Post body using a tiny markdown subset: # / ## / ### headings,
 * paragraphs, bullet lists, and `triple-backtick` code blocks. Intentionally
 * limited — no HTML pass-through, no link rewrites, no script tags. The
 * narrow surface keeps post authoring simple and removes XSS as a concern
 * (every node is a known component output).
 *
 * Wrapped in PublicShell. */

import { useParams, Navigate } from 'react-router-dom'
import { PublicShell } from '../layout/PublicShell'
import { POSTS } from '../content/posts'
import { renderMarkdown } from '../lib/markdown'

export function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>()
  const post = POSTS.find((p) => p.slug === slug)
  if (!post) return <Navigate to="/blog" replace />

  return (
    <PublicShell>
      <BlogPostStyles />
      <article className="post-wrap">
        <a href="/blog" className="post-back">← All posts</a>
        <header className="post-head">
          <time dateTime={post.date} className="post-date">{formatDate(post.date)}</time>
          <h1 className="post-title">{post.title}</h1>
          <p className="post-author">By {post.author}</p>
        </header>
        <div className="post-body">
          {renderMarkdown(post.body, { baseHeading: 'h2', keyPrefix: post.slug })}
        </div>
        <footer className="post-foot">
          <a href="/blog" className="post-foot-link">More posts</a>
          <a href="/docs" className="post-foot-link">Read the docs →</a>
        </footer>
      </article>
    </PublicShell>
  )
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function BlogPostStyles() {
  return (
    <style>{`
      .post-wrap { max-width: 720px; margin: 0 auto; padding: 40px 24px 80px; }
      .post-back { color: var(--text-dim); text-decoration: none; font-size: 14px; }
      .post-back:hover { color: var(--accent); }
      .post-head { margin: 24px 0 40px; padding-bottom: 24px; border-bottom: 1px solid var(--border-hi); }
      .post-date { color: var(--text-dim); font-size: 14px; font-variant-numeric: tabular-nums; }
      .post-title { font-size: 36px; margin: 8px 0 16px; letter-spacing: -0.02em; line-height: 1.15; color: var(--text); }
      .post-author { color: var(--text-dim); font-size: 15px; margin: 0; }
      .post-body { font-size: 17px; line-height: 1.65; color: var(--text); }
      .post-body h1 { font-size: 28px; margin: 40px 0 16px; letter-spacing: -0.015em; }
      .post-body h2 { font-size: 22px; margin: 36px 0 12px; letter-spacing: -0.01em; }
      .post-body h3 { font-size: 18px; margin: 28px 0 8px; }
      .post-body p { margin: 0 0 18px; }
      .post-body ul { margin: 0 0 18px; padding-left: 24px; }
      .post-body li { margin: 6px 0; }
      .post-body code { background: var(--ink); border: 1px solid var(--border); color: var(--text); padding: 1px 6px; border-radius: 4px; font-size: 14px; font-family: var(--font-mono); }
      .post-body pre { background: var(--code-bg); color: var(--text); border: 1px solid var(--border); padding: 16px 20px; border-radius: 8px; overflow-x: auto; font-size: 14px; line-height: 1.5; margin: 18px 0; }
      /* Reserve top padding for the floating Copy button (CodeBlock). */
      .post-body pre.code-block { padding-top: 36px; }
      .post-body pre code { background: transparent; padding: 0; color: inherit; }
      .post-body strong { font-weight: 600; }
      .post-foot { margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--border-hi); display: flex; justify-content: space-between; }
      .post-foot-link { color: var(--accent); text-decoration: none; font-size: 15px; }
    `}</style>
  )
}
