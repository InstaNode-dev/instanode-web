/* ForAgentsPage — public marketing page at /for-agents.
   Targets agent-tool builders (Claude Code, Cursor, MCP devs).
   No npm deps, no Lorem Ipsum. Wrapped in PublicShell. */

import { useState, type ReactNode } from 'react'
import { PublicShell } from '../layout/PublicShell'
import { copyToClipboard } from '../components/Common'

// The MCP server is published to npm as the unscoped `instanode-mcp`
// (see mcp/package.json `name`). The earlier `@instanode/mcp` scoped name
// was never published — `npx -y @instanode/mcp` 404s. Keep this in sync
// with mcp/package.json.
const MCP_PACKAGE = 'instanode-mcp'

// `claude mcp add` and `cursor mcp add` need a `--` separator before the
// command + args, otherwise the CLI parses `npx` / `-y` as its own flags.
const CLAUDE_CMD = `claude mcp add instanode -- npx -y ${MCP_PACKAGE}`
const CURSOR_CMD = `cursor mcp add instanode -- npx -y ${MCP_PACKAGE}`
const MCP_JSON = JSON.stringify(
  { mcpServers: { instanode: { command: 'npx', args: ['-y', MCP_PACKAGE] } } },
  null,
  2
)

// DOG-39 (2026-05-29): the CLI install path (cli#18 + .goreleaser.yml release
// notes) was invisible to anyone landing on /for-agents — only MCP runtimes
// were surfaced. The canonical curl-bash install lives at
// https://raw.githubusercontent.com/InstaNode-dev/cli/master/install.sh; we
// don't yet vendor it on instanode.dev (DOG-41 — operator follow-up), but the
// canonical raw URL is the documented install path on the cli release page
// and in the cli repo README, so referencing it here is honest.
const CLI_INSTALL = 'curl -fsSL https://raw.githubusercontent.com/InstaNode-dev/cli/master/install.sh | sh'

const REASONS: { eyebrow: string; body: string }[] = [
  {
    eyebrow: '01 · zero-auth first call',
    body:
      'No auth wall on first call. /db/new returns a connection string in <2s. Anonymous fingerprint-rate-limited.'
  },
  {
    eyebrow: '02 · self-describing api',
    body:
      'Self-describing. /openapi.json + /llms.txt + every response has the next-best agent action embedded in the `note` field.'
  },
  {
    eyebrow: '03 · idempotent claim',
    body:
      "Idempotent claim. The same JWT can be claimed exactly once — atomically. Your agent's logic is deterministic."
  },
  {
    eyebrow: '04 · safe retries on every create',
    body:
      'Every create endpoint deduplicates retries. Pass an Idempotency-Key header for true exactly-once across a 24h window, or just retry safely — the server fingerprints (scope + route + canonical body) and replays for 120s. The response header X-Idempotent-Replay: true tells you when you hit the cache.'
  }
]

const PLAYGROUND_CURL = `curl -X POST https://api.instanode.dev/db/new \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"prod-db"}'`

// Mirrors a real POST /db/new response. `env` is echoed on every
// provisioning response (CLAUDE.md convention #11) — a caller that omits
// `env` lands in `development`, the lowest-stakes bucket. The earlier
// sample dropped it, so the page misrepresented the wire shape.
const PLAYGROUND_RESPONSE = `{
  "ok": true,
  "token": "res_2RtL9k4mP",
  "connection_url": "postgres://u_3jX:••••@shared-1.instanode.dev:5432/db_2rtL9k4mp",
  "tier": "anonymous",
  "env": "development",
  "limits": { "storage_mb": 10, "connections": 2 },
  "upgrade_url": "https://instanode.dev/start?t=eyJhbGciOi...",
  "upgrade_jwt": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "note": "Resource expires in 24h. Claim with the link above to keep it."
}`

export function ForAgentsPage() {
  return (
    <PublicShell>
      <ForAgentsStyles />

      {/* ---------- Hero ---------- */}
      <section className="fa-hero">
        <span className="public-eyebrow">For agents · MCP · CLI · curl</span>
        <h1 className="public-h1">
          Built for agents<span className="dot">.</span>
        </h1>
        <p className="public-sub">
          instanode.dev is the only PaaS where the unit of value is one HTTP call.
        </p>
      </section>

      {/* ---------- Three integration cards ---------- */}
      <section className="public-section" aria-labelledby="integ-h">
        <h2 id="integ-h" className="public-section-h">Drop-in integrations</h2>
        <p className="public-section-sub">
          Pick your agent runtime. Three commands or less.
        </p>

        <div className="fa-card-grid">
          <IntegrationCard
            title="Claude Code"
            hint="One-line install. Works across all Claude Code projects."
            command={CLAUDE_CMD}
            mode="shell"
          />
          <IntegrationCard
            title="Cursor"
            hint="Adds the MCP server to Cursor's agent runtime."
            command={CURSOR_CMD}
            mode="shell"
          />
          <IntegrationCard
            title="MCP server config"
            hint="Drop into ~/.config/mcp/mcp.json (or any MCP host)."
            command={MCP_JSON}
            mode="json"
          />
          {/* DOG-39: CLI persona — the binary release (cli#18) lives on
              GitHub releases; install via the canonical curl-bash one-liner.
              Surfaces the cli path for engineers who don't want an agent
              runtime but do want a deterministic local tool. */}
          <IntegrationCard
            title="instanode CLI"
            hint="Single binary. Same agent flow, from your shell."
            command={CLI_INSTALL}
            mode="shell"
          />
        </div>
      </section>

      {/* ---------- Why agents like us ---------- */}
      <section className="public-section" aria-labelledby="why-h">
        <h2 id="why-h" className="public-section-h">Why agents like us</h2>
        <p className="public-section-sub">
          Three properties that make agent code deterministic.
        </p>

        <div className="fa-reasons">
          {REASONS.map((r) => (
            <article className="fa-reason" key={r.eyebrow}>
              <div className="fa-reason-eyebrow">{r.eyebrow}</div>
              <p className="fa-reason-body">{r.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ---------- Code playground tease ---------- */}
      <section className="public-section" aria-labelledby="play-h">
        <h2 id="play-h" className="public-section-h">One call. Real Postgres.</h2>
        <p className="public-section-sub">
          Below is what hits the wire — request and response. No mocks.
        </p>

        <div className="fa-play">
          <div className="fa-play-pane">
            <div className="fa-play-head">
              <span className="fa-play-dot fa-play-dot--req" />
              request
              <span className="fa-play-meta">curl · http/2</span>
            </div>
            <pre className="public-code"><code>{highlightShell(PLAYGROUND_CURL)}</code></pre>
          </div>

          <div className="fa-play-pane">
            <div className="fa-play-head">
              <span className="fa-play-dot fa-play-dot--res" />
              response
              <span className="fa-play-meta">200 · 1.4s · application/json</span>
            </div>
            <pre className="public-code"><code>{highlightJson(PLAYGROUND_RESPONSE)}</code></pre>
          </div>
        </div>
      </section>

      {/* ---------- Final CTA ---------- */}
      <section className="public-section">
        <div className="fa-final">
          <h2 className="fa-final-h">Read the OpenAPI spec.</h2>
          <p className="fa-final-sub">
            Every endpoint, every shape, every <code className="fa-inline">note</code> field. Wired for agent consumption.
          </p>
          <a
            href="https://api.instanode.dev/openapi.json"
            className="fa-final-cta"
            target="_blank"
            rel="noreferrer"
          >
            <span>https://api.instanode.dev/openapi.json</span>
            <span aria-hidden="true">→</span>
          </a>
        </div>
      </section>
    </PublicShell>
  )
}

function IntegrationCard({
  title,
  hint,
  command,
  mode
}: {
  title: string
  hint: string
  command: string
  mode: 'shell' | 'json'
}) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    const ok = await copyToClipboard(command)
    if (!ok) {
      console.warn('[ForAgentsPage] copy failed — clipboard unavailable')
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }
  return (
    <article className="fa-card">
      <header className="fa-card-h">
        <h3 className="fa-card-title">{title}</h3>
        <button type="button" className="fa-card-copy" onClick={onCopy} aria-label={`Copy ${title} command`}>
          {copied ? 'copied' : 'copy'}
        </button>
      </header>
      <pre className="public-code fa-card-code">
        <code>{mode === 'shell' ? highlightShell(command) : highlightJson(command)}</code>
      </pre>
      <p className="fa-card-hint">{hint}</p>
    </article>
  )
}

/* ----- Tiny syntax highlighters ----- */

function highlightShell(text: string): ReactNode {
  // recognize: leading binary, $ prefix, --flags, single-quoted strings, comments
  const lines = text.split('\n')
  return lines.map((line, li) => {
    const out: ReactNode[] = []
    let rest = line
    // comments
    if (rest.trim().startsWith('#')) {
      out.push(<span className="c-comment" key={`c-${li}`}>{rest}</span>)
    } else {
      // single-quoted strings
      const re = /('[^']*')|(\s--?[a-zA-Z][\w-]*)/g
      let last = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(rest)) !== null) {
        if (m.index > last) out.push(rest.slice(last, m.index))
        if (m[1]) out.push(<span className="c-str" key={`s-${li}-${m.index}`}>{m[1]}</span>)
        else if (m[2]) out.push(<span className="c-flag" key={`f-${li}-${m.index}`}>{m[2]}</span>)
        last = m.index + m[0].length
      }
      if (last < rest.length) out.push(rest.slice(last))
    }
    return (
      <span key={`l-${li}`}>
        {out}
        {li < lines.length - 1 ? '\n' : null}
      </span>
    )
  })
}

function highlightJson(text: string): ReactNode {
  // Keys: "...":  Strings: "..."  Numbers, booleans
  const re = /("[^"\\]*(?:\\.[^"\\]*)*")(\s*:)?|(\b\d+(?:\.\d+)?\b)|(\btrue\b|\bfalse\b|\bnull\b)/g
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1] && m[2]) {
      out.push(<span className="c-key" key={`k-${i++}`}>{m[1]}</span>)
      out.push(m[2])
    } else if (m[1]) {
      out.push(<span className="c-str" key={`s-${i++}`}>{m[1]}</span>)
    } else if (m[3]) {
      out.push(<span className="c-num" key={`n-${i++}`}>{m[3]}</span>)
    } else if (m[4]) {
      out.push(<span className="c-bool" key={`b-${i++}`}>{m[4]}</span>)
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/* ----- Page-local styles ----- */
function ForAgentsStyles() {
  return (
    <style>{`
      .fa-hero { padding-top: 8px; }
      .fa-inline {
        font-family: var(--font-mono);
        font-size: 12px;
        background: var(--code-bg);
        border: 1px solid var(--border);
        padding: 1px 6px; border-radius: 4px;
        color: var(--text);
      }

      /* integration grid */
      .fa-card-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 16px;
      }
      @media (max-width: 980px) {
        .fa-card-grid { grid-template-columns: 1fr; }
      }
      .fa-card {
        background: var(--surface);
        border: 1px solid var(--border-hi);
        border-radius: 12px;
        padding: 18px;
        display: flex; flex-direction: column; gap: 14px;
        transition: border-color 150ms, transform 150ms;
      }
      .fa-card:hover {
        border-color: rgba(0,228,142,0.3);
        transform: translateY(-2px);
      }
      .fa-card-h {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
      }
      .fa-card-title {
        font-size: 14px; font-weight: 500;
        letter-spacing: -0.01em;
      }
      .fa-card-copy {
        font-family: var(--font-mono);
        font-size: 10.5px;
        padding: 4px 10px;
        background: var(--ink);
        border: 1px solid var(--border);
        color: var(--text-dim);
        border-radius: 5px;
        transition: all 120ms;
      }
      .fa-card-copy:hover { color: var(--accent); border-color: rgba(0,228,142,0.35); }
      .fa-card-code {
        font-size: 11.5px;
        line-height: 1.6;
        max-height: 220px;
        overflow: auto;
      }
      .fa-card-hint {
        font-size: 12.5px;
        color: var(--text-dim);
        line-height: 1.5;
      }

      /* reasons */
      .fa-reasons {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 14px;
      }
      @media (max-width: 1180px) {
        .fa-reasons { grid-template-columns: repeat(2, 1fr); }
      }
      @media (max-width: 640px) {
        .fa-reasons { grid-template-columns: 1fr; }
      }
      .fa-reason {
        background: var(--ink);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 22px 20px;
        display: flex; flex-direction: column; gap: 10px;
        position: relative;
        overflow: hidden;
      }
      .fa-reason::before {
        content: ""; position: absolute; left: 0; top: 0; bottom: 0;
        width: 2px; background: var(--accent);
        opacity: 0.6;
      }
      .fa-reason-eyebrow {
        font-family: var(--font-mono);
        font-size: 10.5px;
        color: var(--accent);
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .fa-reason-body {
        font-size: 14px;
        color: var(--text);
        line-height: 1.55;
      }

      /* playground */
      .fa-play {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
      }
      @media (max-width: 980px) {
        .fa-play { grid-template-columns: 1fr; }
      }
      .fa-play-pane {
        background: var(--surface);
        border: 1px solid var(--border-hi);
        border-radius: 12px;
        overflow: hidden;
        display: flex; flex-direction: column;
      }
      .fa-play-head {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 14px;
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--text-dim);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        background: var(--elevated);
        border-bottom: 1px solid var(--border);
      }
      .fa-play-meta { margin-left: auto; color: var(--text-faint); text-transform: none; letter-spacing: 0; }
      .fa-play-dot {
        width: 8px; height: 8px; border-radius: 50%;
      }
      .fa-play-dot--req { background: var(--blue); box-shadow: 0 0 6px rgba(108,206,255,0.6); }
      .fa-play-dot--res { background: var(--accent); box-shadow: 0 0 6px var(--accent-glow); }
      .fa-play-pane .public-code {
        border: 0; border-radius: 0;
        margin: 0;
        padding: 18px;
        background: var(--code-bg);
        flex: 1;
      }

      /* final cta */
      .fa-final {
        background: linear-gradient(135deg, rgba(0,228,142,0.06), rgba(108,206,255,0.04));
        border: 1px solid rgba(0,228,142,0.22);
        border-radius: 14px;
        padding: 36px 32px;
        text-align: center;
      }
      .fa-final-h {
        font-family: var(--font-display);
        font-size: 28px; font-weight: 400;
        letter-spacing: -0.025em;
        margin-bottom: 8px;
      }
      .fa-final-sub {
        font-size: 14px; color: var(--text-dim);
        margin-bottom: 20px;
      }
      .fa-final-cta {
        display: inline-flex; align-items: center; gap: 10px;
        padding: 12px 18px;
        background: var(--ink);
        border: 1px solid var(--accent);
        border-radius: 8px;
        font-family: var(--font-mono);
        font-size: 13px;
        color: var(--accent);
        transition: all 150ms;
      }
      .fa-final-cta:hover {
        background: rgba(0,228,142,0.06);
        box-shadow: 0 0 0 4px rgba(0,228,142,0.12);
      }
    `}</style>
  )
}
