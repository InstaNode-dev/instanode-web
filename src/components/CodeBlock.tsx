/* CodeBlock — shared fenced-code-block component for docs / blog /
 * use-case posts. Renders a `<pre><code class="language-X">...` with:
 *
 *   - lightweight syntax highlighting for bash, json, yaml (no Prism /
 *     Shiki dependency — single-file regex tokenizer, ~1 KB gzipped,
 *     keeps the marketing bundle small)
 *   - a Copy button in the top-right corner that uses the
 *     navigator.clipboard API (with a textarea fallback) and flashes
 *     "Copied!" for 1.5 s
 *
 * Used everywhere the markdown renderer (src/lib/markdown.tsx) sees a
 * fenced block. BugBash B3-P2-1 + B3-P2-2 — public docs / blog had
 * monochrome code + no copy button before this. */

import { useState } from 'react'
import { copyToClipboard } from './Common'

export type CodeBlockProps = {
  code: string
  lang: string | null
}

export function CodeBlock({ code, lang }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const language = normalizeLang(lang)

  const handleCopy = async () => {
    const ok = await copyToClipboard(code)
    if (!ok) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <pre
      className={`code-block${language ? ` language-${language}` : ''}`}
      data-lang={language ?? ''}
    >
      {language && (
        <span className="code-block-lang" aria-hidden="true">{language}</span>
      )}
      <button
        type="button"
        className="code-block-copy"
        onClick={handleCopy}
        aria-label={copied ? 'Copied to clipboard' : 'Copy code to clipboard'}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <code className={language ? `language-${language}` : undefined}>
        {language ? <Highlighted code={code} lang={language} /> : code}
      </code>
    </pre>
  )
}

/* normalizeLang — maps common aliases to one of the three languages
 * we actually highlight. Anything we don't know returns null so the
 * caller renders monochrome (still better than the pre-fix baseline
 * but never wrong-coloured). */
function normalizeLang(raw: string | null): 'bash' | 'json' | 'yaml' | null {
  if (!raw) return null
  const l = raw.toLowerCase()
  if (l === 'bash' || l === 'sh' || l === 'shell' || l === 'zsh' || l === 'console') return 'bash'
  if (l === 'json' || l === 'jsonc') return 'json'
  if (l === 'yaml' || l === 'yml') return 'yaml'
  return null
}

/* Highlighted — tiny regex tokenizer per language. Intentionally
 * minimal: covers strings, numbers, comments, booleans, keywords,
 * and one or two language-specific affordances (curl flags, JSON
 * keys). Anything not matched falls through as plain text — never
 * mis-tokens. */
function Highlighted({ code, lang }: { code: string; lang: 'bash' | 'json' | 'yaml' }) {
  switch (lang) {
    case 'bash': return <>{tokenizeBash(code)}</>
    case 'json': return <>{tokenizeJson(code)}</>
    case 'yaml': return <>{tokenizeYaml(code)}</>
  }
}

type Tok = { text: string; cls?: string }

function render(toks: Tok[]): JSX.Element[] {
  return toks.map((t, i) =>
    t.cls
      ? <span key={i} className={`tok-${t.cls}`}>{t.text}</span>
      : <span key={i}>{t.text}</span>,
  )
}

function tokenizeBash(src: string): JSX.Element[] {
  // Match — in order — comments, strings, flags, numbers, keywords.
  // Anything else is plain. Iterates the string with a regex so we
  // don't mangle nested cases.
  const re = /(#[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\s-{1,2}[A-Za-z][\w-]*)|(\b\d+\b)|(\b(?:curl|export|cd|ls|cat|echo|grep|awk|sed|sudo|kubectl|docker|npm|node|go|brew)\b)/g
  return tokenize(src, re, (m) => {
    if (m[1]) return 'comment'
    if (m[2]) return 'string'
    if (m[3]) return 'flag'
    if (m[4]) return 'number'
    if (m[5]) return 'keyword'
    return undefined
  })
}

function tokenizeJson(src: string): JSX.Element[] {
  // Keys ("foo":) before values; numbers; booleans/null; strings.
  // Trailing-comma tolerance is moot — input is rarely invalid JSON.
  const re = /("(?:[^"\\]|\\.)*"\s*:)|("(?:[^"\\]|\\.)*")|(\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\b(?:true|false|null)\b)/g
  return tokenize(src, re, (m) => {
    if (m[1]) return 'key'
    if (m[2]) return 'string'
    if (m[3]) return 'number'
    if (m[4]) return 'bool'
    return undefined
  })
}

function tokenizeYaml(src: string): JSX.Element[] {
  // Comments; quoted strings; numbers; booleans; keys (foo:).
  const re = /(#[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(^[ \t]*[\w.-]+(?=\s*:))|(\b-?\d+(?:\.\d+)?\b)|(\b(?:true|false|null|yes|no)\b)/gm
  return tokenize(src, re, (m) => {
    if (m[1]) return 'comment'
    if (m[2]) return 'string'
    if (m[3]) return 'key'
    if (m[4]) return 'number'
    if (m[5]) return 'bool'
    return undefined
  })
}

/* tokenize — generic splitter. Walks `src` against `re` (must be
 * /g), emits Tok[] alternating plain + matched spans, returns
 * the rendered JSX. */
function tokenize(
  src: string,
  re: RegExp,
  classify: (m: RegExpExecArray) => string | undefined,
): JSX.Element[] {
  const toks: Tok[] = []
  let last = 0
  for (let m: RegExpExecArray | null; (m = re.exec(src)) !== null; ) {
    if (m.index > last) toks.push({ text: src.slice(last, m.index) })
    toks.push({ text: m[0], cls: classify(m) })
    last = m.index + m[0].length
  }
  if (last < src.length) toks.push({ text: src.slice(last) })
  return render(toks)
}
