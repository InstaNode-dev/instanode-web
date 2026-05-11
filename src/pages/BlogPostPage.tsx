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
import { POSTS, type Post } from '../content/posts'

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
        <div className="post-body">{renderMarkdown(post.body, post)}</div>
        <footer className="post-foot">
          <a href="/blog" className="post-foot-link">More posts</a>
          <a href="/docs" className="post-foot-link">Read the docs →</a>
        </footer>
      </article>
    </PublicShell>
  )
}

// renderMarkdown is intentionally minimal. It splits on blank lines into
// block-level elements and pattern-matches each block. Inline formatting is
// limited to `code`, **bold**, and naked URLs. No HTML is parsed; every
// rendered node is a React element of a known type.
function renderMarkdown(md: string, post: Post): React.ReactNode {
  const blocks = md.trim().split(/\n\n+/)
  return blocks.map((block, i) => {
    const key = `${post.slug}-${i}`
    if (block.startsWith('### ')) return <h3 key={key}>{inline(block.slice(4))}</h3>
    if (block.startsWith('## ')) return <h2 key={key}>{inline(block.slice(3))}</h2>
    if (block.startsWith('# ')) return <h1 key={key}>{inline(block.slice(2))}</h1>
    if (block.startsWith('```')) {
      const inner = block.replace(/^```\w*\n?/, '').replace(/\n?```$/, '')
      return <pre key={key}><code>{inner}</code></pre>
    }
    if (block.startsWith('- ') || block.startsWith('* ')) {
      const items = block.split('\n').filter((l) => l.startsWith('- ') || l.startsWith('* '))
      return (
        <ul key={key}>
          {items.map((item, j) => (
            <li key={`${key}-${j}`}>{inline(item.slice(2))}</li>
          ))}
        </ul>
      )
    }
    return <p key={key}>{inline(block)}</p>
  })
}

// inline handles `code`, **bold**, and plain text. Splits on tokens then
// rebuilds with appropriate React elements.
function inline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let rest = text
  let key = 0
  while (rest.length > 0) {
    const code = rest.match(/^(.*?)`([^`]+)`(.*)$/)
    if (code) {
      if (code[1]) parts.push(code[1])
      parts.push(<code key={`c-${key++}`}>{code[2]}</code>)
      rest = code[3]
      continue
    }
    const bold = rest.match(/^(.*?)\*\*(.+?)\*\*(.*)$/)
    if (bold) {
      if (bold[1]) parts.push(bold[1])
      parts.push(<strong key={`b-${key++}`}>{bold[2]}</strong>)
      rest = bold[3]
      continue
    }
    parts.push(rest)
    break
  }
  return parts
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
      .post-back { color: var(--text-muted, #6b7280); text-decoration: none; font-size: 14px; }
      .post-back:hover { color: var(--accent, #3b82f6); }
      .post-head { margin: 24px 0 40px; padding-bottom: 24px; border-bottom: 1px solid var(--border, #e5e7eb); }
      .post-date { color: var(--text-muted, #6b7280); font-size: 14px; font-variant-numeric: tabular-nums; }
      .post-title { font-size: 36px; margin: 8px 0 16px; letter-spacing: -0.02em; line-height: 1.15; }
      .post-author { color: var(--text-muted, #6b7280); font-size: 15px; margin: 0; }
      .post-body { font-size: 17px; line-height: 1.65; color: var(--text, #1f2937); }
      .post-body h1 { font-size: 28px; margin: 40px 0 16px; letter-spacing: -0.015em; }
      .post-body h2 { font-size: 22px; margin: 36px 0 12px; letter-spacing: -0.01em; }
      .post-body h3 { font-size: 18px; margin: 28px 0 8px; }
      .post-body p { margin: 0 0 18px; }
      .post-body ul { margin: 0 0 18px; padding-left: 24px; }
      .post-body li { margin: 6px 0; }
      .post-body code { background: #f4f4f5; padding: 2px 6px; border-radius: 4px; font-size: 14px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .post-body pre { background: #0f172a; color: #e2e8f0; padding: 16px 20px; border-radius: 8px; overflow-x: auto; font-size: 14px; line-height: 1.5; margin: 18px 0; }
      .post-body pre code { background: transparent; padding: 0; color: inherit; }
      .post-body strong { font-weight: 600; }
      .post-foot { margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--border, #e5e7eb); display: flex; justify-content: space-between; }
      .post-foot-link { color: var(--accent, #3b82f6); text-decoration: none; font-size: 15px; }
    `}</style>
  )
}
