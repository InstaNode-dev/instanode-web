/* BlogPostPage — public /blog/:slug detail.
 *
 * Renders a Post body using a tiny markdown subset: # / ## / ### headings,
 * paragraphs, bullet lists, and `triple-backtick` code blocks. Intentionally
 * limited — no HTML pass-through, no link rewrites, no script tags. The
 * narrow surface keeps post authoring simple and removes XSS as a concern
 * (every node is a known component output).
 *
 * Wrapped in PublicShell. */

import { useEffect } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { PublicShell } from '../layout/PublicShell'
import { POSTS, type Post } from '../content/posts'
import { renderMarkdown } from '../lib/markdown'

const SITE_ORIGIN = 'https://instanode.dev'
const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/apple-touch-icon.png`

export function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>()
  const post = POSTS.find((p) => p.slug === slug)

  // B3-P1-1 + B3-P1-9 (BugBash 2026-05-20): per-post SEO meta + SPA-nav
  // title re-application. The static prerender bakes a per-post <title>
  // at build time via scripts/prerender.mjs (metaForRoute), so cold crawler
  // requests are correctly tagged. But once the SPA hydrates and a visitor
  // clicks between posts inside the app, the title never updates — React
  // Router has no document-title hook of its own. This effect mirrors the
  // build-time title/description/canonical/OG into the live document on
  // every mount + slug change, and restores the homepage defaults on
  // unmount so the next public-page nav doesn't inherit stale post meta.
  // Also emits a BlogPosting JSON-LD blob so generative-engine + Google
  // rich-result crawlers can index the post as an article (B3-P1-1).
  useEffect(() => {
    if (typeof document === 'undefined' || !post) return
    const prev = captureCurrentMeta()
    applyMeta({
      title: `${post.title} · instanode blog`,
      description: post.excerpt || 'Engineering writing from instanode.dev.',
      canonical: `${SITE_ORIGIN}/blog/${post.slug}`,
      ogType: 'article',
      ogImage: DEFAULT_OG_IMAGE,
      articlePublishedTime: post.date,
      articleAuthor: post.author,
    })
    const ld = upsertJsonLd(buildBlogPostingLd(post))
    return () => {
      applyMeta(prev)
      ld?.remove()
    }
  }, [post])

  if (!post) return <Navigate to="/blog" replace />

  // B3-P1-5 / B3-P1-6 (BugBash 2026-05-20): some content-repo posts open
  // with a leading `# Heading` that duplicates the frontmatter `title`.
  // The page already renders <h1 className="post-title">{post.title}</h1>
  // in <header>, so the body's leading H1 produced a duplicate heading +
  // (worse) absorbed a sibling fenced code block into its line when the
  // renderer ran with baseHeading='h2'. Strip the first `# ` block if it
  // matches the frontmatter title so the body starts at H2.
  const body = stripDuplicateLeadingH1(post.body, post.title)

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
          {renderMarkdown(body, { baseHeading: 'h2', keyPrefix: post.slug })}
        </div>
        <footer className="post-foot">
          <a href="/blog" className="post-foot-link">More posts</a>
          <a href="/docs" className="post-foot-link">Read the docs →</a>
        </footer>
      </article>
    </PublicShell>
  )
}

/* stripDuplicateLeadingH1 — if the markdown body opens with `# X` where X
 * matches the frontmatter title (case-insensitive, whitespace-normalised),
 * drop that block. Returns the body unchanged otherwise. The match
 * tolerates trailing inline markdown (e.g. `# Sixty seconds, one prompt`
 * vs frontmatter "Sixty seconds, one prompt") by stripping non-alphanumeric
 * characters from both sides before comparing — same loose match a human
 * reader would apply. Subsequent H1s in the body are preserved as
 * authored. */
export function stripDuplicateLeadingH1(body: string, title: string): string {
  const trimmed = body.replace(/^\s+/, '')
  const m = trimmed.match(/^#\s+(.+?)\r?\n/)
  if (!m) return body
  const normalised = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (normalised(m[1]) !== normalised(title)) return body
  return trimmed.slice(m[0].length).replace(/^\s+/, '')
}

/* captureCurrentMeta / applyMeta — minimal document.head writer used to
 * apply per-post SEO tags on mount and restore the previous values on
 * unmount. We swap (not append) so leaving a post page doesn't leave its
 * og:type="article" stale on the next non-article page. Keys mirror the
 * tags scripts/prerender.mjs rewrites at build time. */
type MetaPatch = {
  title?: string
  description?: string
  canonical?: string
  ogType?: string
  ogImage?: string
  articlePublishedTime?: string | null
  articleAuthor?: string | null
}

function captureCurrentMeta(): MetaPatch {
  return {
    title: document.title,
    description: getMetaContent('name', 'description') ?? undefined,
    canonical: getLinkHref('canonical') ?? undefined,
    ogType: getMetaContent('property', 'og:type') ?? undefined,
    ogImage: getMetaContent('property', 'og:image') ?? undefined,
    articlePublishedTime: getMetaContent('property', 'article:published_time'),
    articleAuthor: getMetaContent('property', 'article:author'),
  }
}

function applyMeta(patch: MetaPatch) {
  if (patch.title) document.title = patch.title
  if (patch.description) setMeta('name', 'description', patch.description)
  if (patch.canonical) setLinkHref('canonical', patch.canonical)
  if (patch.ogType) setMeta('property', 'og:type', patch.ogType)
  if (patch.ogImage) setMeta('property', 'og:image', patch.ogImage)
  // article:* tags only make sense on a /blog/* page. setMeta(null) removes
  // the tag rather than leaving it pointing at the previous post.
  if (patch.articlePublishedTime === null) removeMeta('property', 'article:published_time')
  else if (patch.articlePublishedTime) setMeta('property', 'article:published_time', patch.articlePublishedTime)
  if (patch.articleAuthor === null) removeMeta('property', 'article:author')
  else if (patch.articleAuthor) setMeta('property', 'article:author', patch.articleAuthor)
}

function getMetaContent(attr: 'name' | 'property', value: string): string | null {
  const el = document.querySelector(`meta[${attr}="${value}"]`)
  return el ? el.getAttribute('content') : null
}
function setMeta(attr: 'name' | 'property', value: string, content: string) {
  let el = document.querySelector(`meta[${attr}="${value}"]`) as HTMLMetaElement | null
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, value)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}
function removeMeta(attr: 'name' | 'property', value: string) {
  const el = document.querySelector(`meta[${attr}="${value}"]`)
  if (el) el.remove()
}
function getLinkHref(rel: string): string | null {
  const el = document.querySelector(`link[rel="${rel}"]`)
  return el ? el.getAttribute('href') : null
}
function setLinkHref(rel: string, href: string) {
  let el = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', rel)
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

/* upsertJsonLd — emit a single <script type="application/ld+json"> block
 * for the current post. The id="blog-jsonld" lets cleanup find + remove
 * the same node on unmount, so we never leave stale JSON-LD attached to
 * the next page. Returns the node so the cleanup closure can call
 * .remove() directly. */
function buildBlogPostingLd(post: Post): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    datePublished: post.date,
    author: { '@type': 'Person', name: post.author },
    publisher: {
      '@type': 'Organization',
      name: 'instanode',
      url: SITE_ORIGIN,
      logo: { '@type': 'ImageObject', url: DEFAULT_OG_IMAGE },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_ORIGIN}/blog/${post.slug}` },
    description: post.excerpt,
  }
}
function upsertJsonLd(payload: Record<string, unknown>): HTMLScriptElement | null {
  if (typeof document === 'undefined') return null
  let el = document.getElementById('blog-jsonld') as HTMLScriptElement | null
  if (!el) {
    el = document.createElement('script')
    el.id = 'blog-jsonld'
    el.type = 'application/ld+json'
    document.head.appendChild(el)
  }
  el.textContent = JSON.stringify(payload)
  return el
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
      .post-body pre code { background: transparent; padding: 0; color: inherit; }
      .post-body strong { font-weight: 600; }
      .post-foot { margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--border-hi); display: flex; justify-content: space-between; }
      .post-foot-link { color: var(--accent); text-decoration: none; font-size: 15px; }
    `}</style>
  )
}
