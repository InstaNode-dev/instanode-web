/* markdown.test.tsx — coverage for the shared markdown renderer.
 *
 * The renderer is used by /docs, /blog/:slug, and /use-cases/:slug. A bug
 * in it affects every public content surface. These tests exercise each
 * supported block + inline construct and a few security boundaries
 * (unsafe href schemes, HTML escaping). */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderMarkdown, inline, slugifyHeading } from './markdown'

function html(md: string, opts?: Parameters<typeof renderMarkdown>[1]) {
  return renderToStaticMarkup(<>{renderMarkdown(md, opts)}</>)
}

function htmlInline(text: string) {
  return renderToStaticMarkup(<>{inline(text)}</>)
}

describe('renderMarkdown — block constructs', () => {
  // B3-P1 (2026-05-20): all headings now emit an auto-slugged `id` so
  // /docs#step-1 deep links land on the right sub-section. Tests below
  // assert both the tag AND the id.
  it('renders ## as the configured base heading (default h3) with slug id', () => {
    expect(html('## Hello')).toBe('<h3 id="hello">Hello</h3>')
  })

  it('respects baseHeading=h2', () => {
    expect(html('## Hello', { baseHeading: 'h2' })).toBe('<h2 id="hello">Hello</h2>')
  })

  it('renders # one level above the base', () => {
    expect(html('# Hello', { baseHeading: 'h2' })).toBe('<h1 id="hello">Hello</h1>')
  })

  it('renders ### one level below ##', () => {
    expect(html('### Sub', { baseHeading: 'h2' })).toBe('<h3 id="sub">Sub</h3>')
  })

  it('clamps heading level into h1-h6', () => {
    // Past h6 should pin to h6, never overflow. Headings now also
    // carry an auto-slug id (B3-P1, 2026-05-20).
    expect(html('### deep\n\n#### deeper\n\n##### deepest', { baseHeading: 'h6' }))
      .toContain('<h6 ')
  })

  it('renders fenced code blocks as <pre><code>', () => {
    expect(html('```\nfoo\nbar\n```')).toBe('<pre><code>foo\nbar</code></pre>')
  })

  it('strips the language hint from the fence', () => {
    expect(html('```bash\nls\n```')).toBe('<pre><code>ls</code></pre>')
  })

  it('renders unordered lists with - bullets', () => {
    expect(html('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>')
  })

  it('renders unordered lists with * bullets', () => {
    expect(html('* one\n* two')).toBe('<ul><li>one</li><li>two</li></ul>')
  })

  it('renders ordered lists with 1. 2. notation as <ol>', () => {
    expect(html('1. first\n2. second')).toBe('<ol><li>first</li><li>second</li></ol>')
  })

  it('renders > as <blockquote>', () => {
    expect(html('> quoted')).toBe('<blockquote>quoted</blockquote>')
  })

  // B3-P1 (2026-05-20): GFM pipe tables now render as real <table>
  // markup instead of a <pre> ASCII art block.
  it('renders | tables as real <table>/<thead>/<tbody>', () => {
    const out = html('| a | b |\n| - | - |\n| 1 | 2 |')
    expect(out).toContain('<table')
    expect(out).toContain('<thead>')
    expect(out).toContain('<tbody>')
    expect(out).toContain('<th')
    expect(out).toContain('<td')
    expect(out).toContain('1')
    expect(out).toContain('2')
    expect(out).not.toContain('<pre')
  })

  it('respects column alignment in GFM tables (:---: → center)', () => {
    const out = html('| a | b |\n| :--- | :---: |\n| 1 | 2 |')
    // First column left-aligned, second column center-aligned. Inline
    // styles use camelCase in React, lower-case "text-align" in HTML.
    expect(out).toMatch(/text-align:\s*left/)
    expect(out).toMatch(/text-align:\s*center/)
  })

  it('falls back to <pre> for a malformed pipe block (no delimiter row)', () => {
    // A single pipe line is not a real GFM table — render as styled pre
    // so authors who happen to start a paragraph with `|` don't crash.
    const out = html('| just a line |')
    expect(out).toContain('class="md-table"')
    expect(out).toContain('<pre')
  })

  it('renders inline markdown inside GFM table cells', () => {
    const out = html('| label | code |\n| - | - |\n| **bold** | `code` |')
    expect(out).toContain('<strong>bold</strong>')
    expect(out).toContain('<code>code</code>')
  })

  it('falls back to <p> for plain text', () => {
    expect(html('Just a paragraph.')).toBe('<p>Just a paragraph.</p>')
  })

  it('separates blocks on blank lines', () => {
    expect(html('## H\n\nbody')).toBe('<h3 id="h">H</h3><p>body</p>')
  })
})

describe('slugifyHeading — auto-slug for heading id (B3-P1)', () => {
  it('lowercases + replaces spaces with hyphens', () => {
    expect(slugifyHeading('Step 1 — Initiate')).toBe('step-1-initiate')
  })

  it('strips inline markdown markers before slugging', () => {
    expect(slugifyHeading('Step 1 — `Initiate`')).toBe('step-1-initiate')
    expect(slugifyHeading('Use **bold** here')).toBe('use-bold-here')
    expect(slugifyHeading('See [docs](/docs)')).toBe('see-docs')
  })

  it('drops punctuation other than - and _', () => {
    expect(slugifyHeading('Hello, world!')).toBe('hello-world')
    expect(slugifyHeading('A/B testing')).toBe('ab-testing')
  })

  it('collapses runs of hyphens', () => {
    expect(slugifyHeading('a -- b')).toBe('a-b')
  })

  it('trims leading + trailing hyphens', () => {
    expect(slugifyHeading('— wrapped —')).toBe('wrapped')
  })

  it('falls back to "section" for an empty slug', () => {
    expect(slugifyHeading('!!!')).toBe('section')
    expect(slugifyHeading('')).toBe('section')
  })
})

describe('inline — token rendering', () => {
  it('renders **bold**', () => {
    expect(htmlInline('a **bold** b')).toBe('a <strong>bold</strong> b')
  })

  it('renders `code`', () => {
    expect(htmlInline('use `npm test` to run')).toBe('use <code>npm test</code> to run')
  })

  it('renders [text](url) as <a>', () => {
    expect(htmlInline('see [docs](/docs)')).toBe('see <a href="/docs">docs</a>')
  })

  // BugBash P3: content-repo cross-links are written two ways —
  // `/use-cases/foo` and `/use-cases/foo.md`. The `.md` form would hit
  // the SPA catch-all and dead-end on the homepage; normalizeInternalHref
  // strips the trailing `.md` from internal links so both resolve.
  it('strips a trailing .md from internal links', () => {
    expect(htmlInline('see [docs](/docs.md)')).toBe('see <a href="/docs">docs</a>')
    expect(htmlInline('[uc](/use-cases/foo-bar.md)'))
      .toBe('<a href="/use-cases/foo-bar">uc</a>')
  })

  it('preserves a query/hash after a stripped .md suffix', () => {
    expect(htmlInline('[x](/blog/post.md#section)'))
      .toBe('<a href="/blog/post#section">x</a>')
  })

  it('does NOT strip .md from external links', () => {
    expect(htmlInline('[raw](https://example.com/readme.md)'))
      .toBe('<a href="https://example.com/readme.md">raw</a>')
  })

  it('renders [text](https://...) as external <a>', () => {
    expect(htmlInline('on [GitHub](https://github.com)')).toBe('on <a href="https://github.com">GitHub</a>')
  })

  it('picks the earliest token when multiple are present', () => {
    expect(htmlInline('**bold** and `code`'))
      .toBe('<strong>bold</strong> and <code>code</code>')
  })

  it('passes plain text through unchanged', () => {
    expect(htmlInline('just words')).toBe('just words')
  })
})

describe('inline — href safety', () => {
  it('rejects javascript: URLs (renders as literal text)', () => {
    const out = htmlInline('[click](javascript:alert(1))')
    expect(out).not.toContain('<a')
    expect(out).toContain('[click]')
  })

  it('rejects data: URLs', () => {
    const out = htmlInline('[img](data:text/html,<script>alert(1)</script>)')
    expect(out).not.toContain('<a')
  })

  it('rejects vbscript: URLs', () => {
    const out = htmlInline('[x](vbscript:msgbox)')
    expect(out).not.toContain('<a')
  })

  it('allows /relative routes', () => {
    expect(htmlInline('[x](/foo)')).toBe('<a href="/foo">x</a>')
  })

  it('allows # anchors', () => {
    expect(htmlInline('[x](#section)')).toBe('<a href="#section">x</a>')
  })
})

describe('renderMarkdown — keyPrefix isolation', () => {
  it('produces stable keys per prefix (smoke test, no error from duplicate keys)', () => {
    // Two side-by-side renders with the same prefix shouldn't crash;
    // React only complains about dup keys among siblings, and these
    // are separate trees, so this is a "doesn't throw" assertion.
    const a = html('## Foo\n\nbody', { keyPrefix: 'a' })
    const b = html('## Foo\n\nbody', { keyPrefix: 'b' })
    expect(a).toBe('<h3 id="foo">Foo</h3><p>body</p>')
    expect(b).toBe('<h3 id="foo">Foo</h3><p>body</p>')
  })
})
