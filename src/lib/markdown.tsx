/* markdown.tsx — shared minimal markdown renderer.
 *
 * The dashboard's public pages (blog posts, /docs, /use-cases detail
 * pages) all render content authored in markdown from the
 * InstaNode-dev/content repo. They share this renderer to keep
 * behaviour identical across surfaces.
 *
 * SUPPORTED SYNTAX (intentionally minimal — anything not listed is
 * rendered as a plain paragraph):
 *   ## Heading
 *   ### Subheading
 *   - bulleted item
 *   1. numbered item
 *   > blockquote
 *   ```fenced code block```
 *   inline `code`
 *   **bold**
 *   [link text](https://example.com)   — http/https/anchor/relative
 *
 * NOT SUPPORTED (deliberate, for XSS safety and to keep this tiny):
 *   Raw HTML pass-through, images, tables, footnotes, definition lists,
 *   strike-through, task lists. If the content repo needs any of these,
 *   extend this file — don't sprinkle markdown libraries into individual
 *   pages.
 *
 * SECURITY: hrefs are validated to start with http://, https://, /, or
 * # before being rendered. Anything else falls back to plain text — this
 * blocks `javascript:` URLs even though content comes from a (trusted)
 * public repo. */

import type { ReactNode } from 'react'
import { CodeBlock } from '../components/CodeBlock'

type Heading = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

export type RenderOptions = {
  /* Base heading level for `## ` blocks. Use this when the body content
   * is rendered under an existing `<h2>` wrapper — pass 'h3' so the
   * body's top-level headings become h3 and `### ` becomes h4. */
  baseHeading?: Heading
  /* Stable prefix for React keys. Avoids collisions when multiple
   * renderMarkdown calls share a parent component. */
  keyPrefix?: string
}

export function renderMarkdown(md: string, opts: RenderOptions = {}): ReactNode {
  const baseLevel = parseInt((opts.baseHeading ?? 'h3').slice(1), 10)
  const prefix = opts.keyPrefix ?? 'md'
  const blocks = md.trim().split(/\n\n+/)

  return blocks.map((rawBlock, i) => {
    const block = rawBlock.trimEnd()
    const key = `${prefix}-${i}`

    if (block.startsWith('# ')) return headingTag(baseLevel - 1, key, block.slice(2))
    if (block.startsWith('## ')) return headingTag(baseLevel, key, block.slice(3))
    if (block.startsWith('### ')) return headingTag(baseLevel + 1, key, block.slice(4))
    if (block.startsWith('#### ')) return headingTag(baseLevel + 2, key, block.slice(5))

    if (block.startsWith('```')) {
      // Capture the optional language fence (e.g. ```bash → 'bash').
      // The CodeBlock component handles syntax highlighting + the
      // "Copy" affordance (BugBash B3-P2-1, B3-P2-2).
      const langMatch = block.match(/^```(\w+)?/)
      const lang = langMatch?.[1] ?? null
      const inner = block.replace(/^```\w*\r?\n?/, '').replace(/\r?\n?```$/, '')
      return <CodeBlock key={key} lang={lang} code={inner} />
    }

    if (block.startsWith('> ')) {
      const text = block
        .split('\n')
        .map((l) => l.replace(/^>\s?/, ''))
        .join(' ')
      return <blockquote key={key}>{inline(text, key)}</blockquote>
    }

    if (/^[-*]\s/.test(block)) {
      const items = block.split('\n').filter((l) => /^[-*]\s/.test(l))
      return (
        <ul key={key}>
          {items.map((item, j) => (
            <li key={`${key}-${j}`}>{inline(item.replace(/^[-*]\s+/, ''), `${key}-${j}`)}</li>
          ))}
        </ul>
      )
    }

    // ASCII tables (`| col | col |`) render as a styled pre block. The
    // shared renderer doesn't parse them into real <table> markup — the
    // minimal pre output is enough for everything currently shipped to
    // the marketing site (a tier-limits table on /docs). Upgrade to
    // <table> when a page actually needs sortable/wrappable rows.
    if (block.startsWith('|')) {
      return <pre key={key} className="md-table"><code>{block}</code></pre>
    }

    if (/^\d+\.\s/.test(block)) {
      const items = block.split('\n').filter((l) => /^\d+\.\s/.test(l))
      return (
        <ol key={key}>
          {items.map((item, j) => (
            <li key={`${key}-${j}`}>{inline(item.replace(/^\d+\.\s+/, ''), `${key}-${j}`)}</li>
          ))}
        </ol>
      )
    }

    return <p key={key}>{inline(block, key)}</p>
  })
}

function headingTag(level: number, key: string, content: string): ReactNode {
  const clamped = Math.min(Math.max(level, 1), 6)
  const Tag = `h${clamped}` as Heading
  return <Tag key={key}>{inline(content, key)}</Tag>
}

/* inline — the per-block tokenizer for ` `code` `, **bold**, [text](url).
 *
 * It walks the string left-to-right, taking the earliest match among
 * the three patterns. Order matters only for overlapping patterns
 * (none in this small grammar) — picking the earliest match means
 * **a `b` c** renders the bold first, not the code inside the bold. */
export function inline(text: string, keyPrefix = 'i'): ReactNode {
  const parts: ReactNode[] = []
  let rest = text
  let n = 0

  while (rest.length > 0) {
    const matches = [
      findMatch(rest, /`([^`]+)`/),
      findMatch(rest, /\*\*([^*]+)\*\*/),
      findMatch(rest, /\[([^\]]+)\]\(([^)]+)\)/),
    ]
    const valid = matches.filter((m): m is RegExpMatchArray => m !== null)
    if (valid.length === 0) {
      parts.push(rest)
      break
    }

    // Pick the earliest-starting match
    valid.sort((a, b) => a.index! - b.index!)
    const m = valid[0]
    const idx = m.index!
    const matched = m[0]
    const k = `${keyPrefix}-${n++}`

    if (idx > 0) parts.push(rest.slice(0, idx))

    if (matched.startsWith('`')) {
      parts.push(<code key={k}>{m[1]}</code>)
    } else if (matched.startsWith('**')) {
      parts.push(<strong key={k}>{m[1]}</strong>)
    } else {
      const href = m[2]
      if (isSafeHref(href)) {
        parts.push(<a key={k} href={normalizeInternalHref(href)}>{m[1]}</a>)
      } else {
        // Unsafe href (e.g. javascript:) — render as plain text
        parts.push(matched)
      }
    }

    rest = rest.slice(idx + matched.length)
  }
  return parts
}

function findMatch(s: string, re: RegExp): RegExpMatchArray | null {
  return s.match(re)
}

/* isSafeHref — whitelist of href schemes we'll render as <a>.
 *
 * Allows http/https (external links), `/` (internal routes), and `#`
 * (anchors). Anything else — including `javascript:`, `data:`, `vbscript:`
 * — is rejected. Content is currently authored in a public repo we
 * trust; this check defends against future contributors and against
 * any future move to user-submitted content. */
function isSafeHref(href: string): boolean {
  if (href.startsWith('/') || href.startsWith('#')) return true
  if (/^https?:\/\//i.test(href)) return true
  return false
}

/* normalizeInternalHref — fixes the .md-suffix inconsistency in
 * content-repo cross-links (BugBash P3).
 *
 * Blog posts and use-case pages in the content repo link to sibling
 * pages two ways: some authors write `/use-cases/foo` (the real SPA
 * route), others write `/use-cases/foo.md` (the source filename). The
 * `.md` form hits the SPA catch-all and silently falls back to the
 * homepage — a dead internal link.
 *
 * We strip a trailing `.md` from internal hrefs (those starting with
 * `/`) so both authoring styles resolve to the same working route.
 * External http(s) links and anchors are left untouched — a real `.md`
 * file on an external host is a legitimate target. A query/hash after
 * the `.md` is preserved (e.g. `/blog/x.md#section` → `/blog/x#section`). */
function normalizeInternalHref(href: string): string {
  if (!href.startsWith('/')) return href
  return href.replace(/\.md(?=$|[?#])/, '')
}
