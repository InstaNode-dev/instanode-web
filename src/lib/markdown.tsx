/* markdown.tsx — shared minimal markdown renderer.
 *
 * The dashboard's public pages (blog posts, /docs, /use-cases detail
 * pages) all render content authored in markdown from the
 * InstaNode-dev/content repo. They share this renderer to keep
 * behaviour identical across surfaces.
 *
 * SUPPORTED SYNTAX (intentionally minimal — anything not listed is
 * rendered as a plain paragraph):
 *   # / ## / ### / #### Heading       — auto-slug `id` for deep links
 *   - bulleted item
 *   1. numbered item
 *   > blockquote
 *   ```fenced code block```
 *   | col | col |                     — GFM pipe table → real <table>
 *   inline `code`
 *   **bold**
 *   [link text](https://example.com)  — http/https/anchor/relative
 *
 * NOT SUPPORTED (deliberate, for XSS safety and to keep this tiny):
 *   Raw HTML pass-through, images, footnotes, definition lists,
 *   strike-through, task lists. If the content repo needs any of these,
 *   extend this file — don't sprinkle markdown libraries into individual
 *   pages.
 *
 * SECURITY: hrefs are validated to start with http://, https://, /, or
 * # before being rendered. Anything else falls back to plain text — this
 * blocks `javascript:` URLs even though content comes from a (trusted)
 * public repo.
 *
 * B3-P1 (2026-05-20):
 *   - All headings (h1..h6) now carry an auto-slugged `id` attribute so
 *     deep links like /docs#step-1-initiate work. Before this only the
 *     DocsPage <h2> wrapper had an id (set manually by the page); h3/h4
 *     inside section bodies had none, so an anchor to a sub-section
 *     silently scrolled to the top of the section.
 *   - Pipe tables now render as real <table>/<thead>/<tbody> markup
 *     instead of a styled <pre> block. Authors can write a standard
 *     GFM table and it actually wraps + reflows on mobile. */

import type { CSSProperties, ReactNode } from 'react'
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

    // GFM pipe tables (`| col | col |\n| --- | --- |\n| a | b |`) parse
    // into real <table>/<thead>/<tbody>. The renderer used to emit a
    // styled <pre> here, which meant authors got ASCII art on every
    // table — no wrap, no reflow, no semantic markup for screen readers.
    // B3-P1 (2026-05-20): full GFM table support. Header row + delimiter
    // row + body rows. Inline markdown (code/bold/link) is rendered
    // inside each cell. Falls back to a styled <pre> if the block
    // doesn't have the GFM delimiter row, so non-table pipe content
    // still renders without crashing.
    if (block.startsWith('|')) {
      const table = parseGfmTable(block, key)
      if (table) return table
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
  // B3-P1 (2026-05-20): auto-slug an id so `/docs#step-1-initiate`
  // scrolls to the actual sub-heading instead of the top of the
  // section. The slug derives from the heading text (after stripping
  // inline markdown markers like `code`, **bold**, [link]). Same
  // algorithm as the GFM "github-slugger" library so anchors authored
  // against GitHub previews keep working on the live site.
  const id = slugifyHeading(content)
  return (
    <Tag key={key} id={id}>
      {inline(content, key)}
    </Tag>
  )
}

/* slugifyHeading — produce a stable URL-fragment id from a heading's
 * raw markdown text. Mirrors GitHub's slug algorithm:
 *   1. Strip inline markdown markers (`code`, **bold**, [link]) so
 *      "## Step 1 — `Initiate`" becomes "Step 1 — Initiate" before
 *      slugging (otherwise the backticks would survive).
 *   2. Lowercase.
 *   3. Replace any character that isn't [a-z0-9-_] (or a space) with
 *      nothing. Spaces collapse to single hyphens.
 *   4. Trim leading/trailing hyphens.
 * Empty results (a heading made entirely of punctuation) fall back to
 * "section" — better than emitting id="" which is invalid HTML. */
export function slugifyHeading(raw: string): string {
  const stripped = raw
    // [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // `code` → code
    .replace(/`([^`]+)`/g, '$1')
    // **bold** → bold
    .replace(/\*\*([^*]+)\*\*/g, '$1')
  const slug = stripped
    .toLowerCase()
    // Replace anything that's not alphanumeric, space, hyphen, underscore.
    .replace(/[^\p{L}\p{N}\s_-]+/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return slug.length > 0 ? slug : 'section'
}

/* parseGfmTable — parse a GFM-style pipe table into <table> markup.
 *
 * Returns null if `block` doesn't look like a real table (e.g. a stray
 * single line that starts with `|` but has no delimiter row beneath).
 * Callers should fall back to the pre/code rendering in that case.
 *
 * Format expected:
 *   | col1 | col2 |
 *   | --- | --- |
 *   | a   | b   |
 *   | c   | d   |
 *
 * Cell text passes through the same `inline()` tokenizer the rest of
 * the renderer uses, so `code`, **bold**, and [link](url) work inside
 * cells. */
function parseGfmTable(block: string, keyPrefix: string): ReactNode | null {
  const lines = block.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return null

  // Second line must be the GFM delimiter row: every cell is dashes
  // (optionally with leading/trailing colons for alignment).
  const delim = lines[1]
  if (!/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(delim)) return null

  const parseRow = (line: string): string[] => {
    // Trim leading/trailing pipe + whitespace, then split on |.
    const trimmed = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '')
    return trimmed.split('|').map((c) => c.trim())
  }

  const headerCells = parseRow(lines[0])
  const aligns = parseRow(delim).map(deriveAlignment)
  const bodyRows = lines.slice(2).map(parseRow)

  return (
    <table key={keyPrefix} className="md-gfm-table">
      <thead>
        <tr>
          {headerCells.map((c, i) => (
            <th key={`${keyPrefix}-th-${i}`} style={alignStyle(aligns[i])}>
              {inline(c, `${keyPrefix}-th-${i}`)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {bodyRows.map((row, r) => (
          <tr key={`${keyPrefix}-tr-${r}`}>
            {row.map((cell, c) => (
              <td key={`${keyPrefix}-td-${r}-${c}`} style={alignStyle(aligns[c])}>
                {inline(cell, `${keyPrefix}-td-${r}-${c}`)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

type Alignment = 'left' | 'right' | 'center' | undefined

function deriveAlignment(delimCell: string): Alignment {
  const t = delimCell.trim()
  const left = t.startsWith(':')
  const right = t.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return undefined
}

function alignStyle(a: Alignment): CSSProperties | undefined {
  return a ? { textAlign: a } : undefined
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
