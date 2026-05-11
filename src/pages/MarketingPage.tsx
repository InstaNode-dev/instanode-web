/**
 * Public marketing landing page for instanode.dev.
 *
 * This is the canonical front door — replaces the static HTML site at
 * web/. Mounted at "/" by the router (router config lives in App.tsx;
 * this file only exports the component). No auth required.
 *
 * Visual reference: /Users/manassrivastava/Documents/Instanode-design/.claude/
 *   worktrees/condescending-hamilton-2492ca/index.html
 *
 * All colors, spacing, fonts come from src/styles/tokens.css. Page-specific
 * layout CSS is scoped via a `.mkt` class wrapper and an inline <style> block
 * so we don't pollute the global token sheet.
 */

import { Brand } from '../components/Common'

// Anchors and route paths used throughout the page. Centralized so we don't
// scatter hardcoded string fragments — easy to update when /pricing or /docs
// gets wired in.
const ROUTES = {
  signin: '/login',
  pricing: '/pricing',
  docs: '/docs',
  blog: '/blog',
  changelog: '/changelog',
  forAgents: '#for-agents',
  playground: '#playground',
} as const

type Service = {
  id: 'pg' | 'rd' | 'mg' | 'qu' | 'st' | 'wh' | 'dp'
  name: string
  curl: string
  liveIn: string
}

const SERVICES: Service[] = [
  { id: 'pg', name: 'Postgres',       curl: 'POST /db/new',      liveIn: '1.4s' },
  { id: 'rd', name: 'Redis',          curl: 'POST /cache/new',   liveIn: '0.9s' },
  { id: 'mg', name: 'MongoDB',        curl: 'POST /nosql/new',   liveIn: '1.2s' },
  { id: 'qu', name: 'Queue (NATS)',   curl: 'POST /queue/new',   liveIn: '0.7s' },
  { id: 'st', name: 'Storage (S3)',   curl: 'POST /storage/new', liveIn: '0.8s' },
  { id: 'wh', name: 'Webhook',        curl: 'POST /webhook/new', liveIn: '0.3s' },
  { id: 'dp', name: 'Deploy',         curl: 'POST /deploy/new',  liveIn: '<10s' },
]

type Plan = {
  id: 'anonymous' | 'hobby' | 'pro' | 'team'
  name: string
  tagline: string
  price: string
  freq: string
  featured?: boolean
  comingSoon?: boolean
  features: string[]
  cta: { label: string; href: string; variant: 'primary' | 'secondary' | 'disabled' }
}

const PLANS: Plan[] = [
  {
    id: 'anonymous',
    name: 'Anonymous',
    tagline: 'For the first call. Before there is a team to bill.',
    price: 'free',
    freq: '· 24 h TTL',
    features: [
      '10 MB Postgres · 2 conn · 24h TTL',
      '5 MB Redis · 5 MB Mongo · 24h TTL',
      '100 stored webhooks · 0 deployments',
      'no vault — claim resources first',
    ],
    cta: { label: 'Try the curl ↗', href: ROUTES.playground, variant: 'secondary' },
  },
  {
    id: 'hobby',
    name: 'Hobby',
    tagline: 'For the side project at 2 a.m. Same agent flow, just doesn’t expire.',
    price: '$9',
    freq: '/ mo',
    features: [
      '1 GB Postgres · 8 conn',
      '50 MB Redis · 100 MB Mongo · 5 conn',
      '1 small deployment · *.deployment.instanode.dev',
      '20 vault entries · production env',
    ],
    cta: { label: 'Start hobby →', href: ROUTES.signin, variant: 'secondary' },
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'For the founder shipping investor-ready software.',
    price: '$49',
    freq: '/ mo',
    featured: true,
    features: [
      '5 GB Postgres · 20 conn',
      '256 MB Redis · 2 GB Mongo · 20 conn',
      '10 medium deployments · custom domain',
      '200 vault entries · multi-env (dev/staging/prod + custom)',
    ],
    cta: { label: 'Start pro →', href: ROUTES.signin, variant: 'primary' },
  },
  {
    id: 'team',
    name: 'Team',
    tagline: 'For the engineering org with envs, vault, and an audit trail.',
    price: '$199',
    freq: '/ mo',
    comingSoon: true,
    features: [
      'Everything in Pro, with larger per-resource limits',
      'Multi-seat workspace · RBAC + audit log',
      'SSO / SAML · 99.9% SLA',
      'Dedicated node pools · priority support',
    ],
    cta: { label: 'Coming soon', href: '#', variant: 'disabled' },
  },
]

export function MarketingPage() {
  return (
    <div className="mkt">
      <style>{MKT_CSS}</style>

      {/* ---------- top nav (sticky, glassmorphic) ---------- */}
      <nav className="mkt-nav" aria-label="Primary">
        <div className="mkt-wrap mkt-nav-inner">
          <a href="/" className="mkt-brand-link" aria-label="instanode home">
            <Brand />
          </a>
          <div className="mkt-nav-links" aria-label="Sections">
            <a href={ROUTES.pricing}>Pricing</a>
            <a href={ROUTES.forAgents}>For agents</a>
            <a href={ROUTES.docs}>Docs</a>
            <a href={ROUTES.blog}>Blog</a>
            <a href={ROUTES.changelog}>Changelog</a>
          </div>
          <div className="mkt-nav-cta">
            <a href={ROUTES.signin} className="btn btn-secondary mkt-hide-mobile">Sign in</a>
            <a href={ROUTES.signin} className="btn btn-primary">
              Get a token <span aria-hidden="true">→</span>
            </a>
          </div>
        </div>
      </nav>

      {/* ---------- hero ---------- */}
      <header className="mkt-hero">
        <div className="mkt-wrap">
          <span className="mkt-eyebrow">
            <span className="mkt-pulse" aria-hidden="true" />
            <strong>Heroku</strong>
            <span className="mkt-arrow">·</span>
            but for AI agents
          </span>
          <h1 className="mkt-h1">
            Real infrastructure your agent can claim
            {' '}
            <span className="mkt-accent">with one curl.</span>
          </h1>
          <p className="mkt-hero-sub">
            Postgres, Redis, MongoDB, queues, storage, webhooks, and deployments.{' '}
            <strong>Provisioned in &lt;2 seconds.</strong>{' '}
            No signup, no Docker, no waitlist.
          </p>
          <div className="mkt-hero-cta">
            <a href={ROUTES.playground} className="btn btn-primary mkt-btn-large">
              Try the curl <span aria-hidden="true">→</span>
            </a>
            <a href={ROUTES.pricing} className="btn btn-secondary mkt-btn-large">
              View pricing
            </a>
          </div>

          <div className="mkt-terminal-stage" id="playground">
            <div className="mkt-terminal-glow" aria-hidden="true" />
            <div className="mkt-terminal" role="img" aria-label="Terminal showing a curl POST to api.instanode.dev/db/new returning a Postgres connection string and a claim URL">
              <div className="mkt-terminal-bar">
                <div className="mkt-terminal-dots" aria-hidden="true">
                  <span className="d r" />
                  <span className="d y" />
                  <span className="d g" />
                </div>
                <span className="mkt-terminal-title">— zsh — api.instanode.dev</span>
                <span className="mkt-terminal-tag" aria-hidden="true">live</span>
              </div>
              <pre className="mkt-terminal-body">
                <span className="line">
                  <span className="prompt">{'$ '}</span>
                  <span className="cmd">
                    <span className="verb">curl</span>{' '}
                    <span className="flag">-X POST</span>{' '}
                    <span className="url">https://api.instanode.dev/db/new</span>
                  </span>
                </span>
                <span className="line out">
                  <span className="ok">→</span>{' '}
                  <span className="key">connection_url:</span>{' '}
                  <span className="str">postgres://usr:****@pg.instanode.dev:5432/db_xY9z2k</span>
                </span>
                <span className="line out">
                  <span className="ok">→</span>{' '}
                  <span className="key">expires_in:</span>{' '}
                  <span className="num">86400s</span>
                </span>
                <span className="line out">
                  <span className="ok">→</span>{' '}
                  <span className="key">claim_url:</span>{' '}
                  <span className="claim">https://instanode.dev/start?t=eyJhbGc...</span>
                </span>
                <span className="line">
                  <span className="prompt">{'$ '}</span>
                  <span className="caret" aria-hidden="true" />
                </span>
              </pre>
            </div>
          </div>
        </div>
      </header>

      {/* ---------- seven services row ---------- */}
      <section className="mkt-section" id="services">
        <div className="mkt-wrap">
          <div className="mkt-section-head">
            <div className="mkt-section-tag">Seven services. One bundle.</div>
            <h2 className="mkt-section-title">
              The whole stack, <span className="mkt-accent">not the pieces.</span>
            </h2>
            <p className="mkt-section-sub">
              Free Postgres alone is commoditized. Free Postgres <em>plus</em> Redis, Mongo,
              queue, storage, webhook, and a real deployment — claimed in one in-flow token —
              is the wedge.
            </p>
          </div>

          <div className="mkt-services" role="list">
            {SERVICES.map((s) => (
              <article key={s.id} className="mkt-service-card" role="listitem">
                <div className={`mkt-service-icon mkt-ico-${s.id}`} aria-hidden="true">
                  {s.id}
                </div>
                <div className="mkt-service-name">{s.name}</div>
                <div className="mkt-service-curl">
                  <span className="verb">{s.curl.split(' ')[0]}</span>{' '}
                  <span className="path">{s.curl.split(' ')[1]}</span>
                </div>
                <div className="mkt-service-meta">
                  <span className="spark" aria-hidden="true">●</span>{' '}
                  live in <strong>{s.liveIn}</strong>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- how it works ---------- */}
      <section className="mkt-section" id="how">
        <div className="mkt-wrap">
          <div className="mkt-section-head">
            <div className="mkt-section-tag">Three steps. No friction.</div>
            <h2 className="mkt-section-title">
              From <span className="mkt-accent">prompt</span> to production, in one chat.
            </h2>
            <p className="mkt-section-sub">
              Anonymous tier with a 24 h TTL. The agent surfaces a claim link when the quota
              tightens. One click → magic link → real dashboard.
            </p>
          </div>

          <div className="mkt-how">
            <article className="mkt-how-step">
              <div className="mkt-step-num">STEP 01 · CALL</div>
              <h3>Agent calls.</h3>
              <p>
                <code>POST /db/new</code> from inside Claude Code, Cursor, your custom MCP
                tool, or a shell script. No keys. No setup.
              </p>
              <div className="mkt-how-visual" aria-hidden="true">
                <div className="r"><span className="k">→ POST</span><span className="v">/db/new</span></div>
                <div className="r"><span className="k">host</span><span className="v dim">api.instanode.dev</span></div>
                <div className="r"><span className="k">auth</span><span className="v dim">none — fingerprinted</span></div>
                <div className="r"><span className="k">body</span><span className="v dim">{'{}'}</span></div>
                <div className="r" style={{ marginTop: 8 }}>
                  <span className="k">status</span><span className="v ok">202 accepted</span>
                </div>
              </div>
            </article>

            <article className="mkt-how-step">
              <div className="mkt-step-num">STEP 02 · PROVISION</div>
              <h3>Real infra spins up.</h3>
              <p>
                Managed Postgres, Redis, or Mongo — encryption at rest, automatic backups, a
                connection string in 1.4 s. 24 h TTL on the free tier.
              </p>
              <div className="mkt-how-visual" aria-hidden="true">
                <div className="r"><span className="k">service</span><span className="v">postgres 16.2</span></div>
                <div className="r"><span className="k">region</span><span className="v dim">iad-1 · us-east</span></div>
                <div className="r"><span className="k">size</span><span className="v">10 MB / 2 conn</span></div>
                <div className="r"><span className="k">expires</span><span className="v dim">in 24h</span></div>
                <div className="r" style={{ marginTop: 8 }}>
                  <span className="k">backup</span><span className="v ok">enabled</span>
                </div>
                <div className="r"><span className="k">tls</span><span className="v ok">required</span></div>
              </div>
            </article>

            <article className="mkt-how-step">
              <div className="mkt-step-num">STEP 03 · CLAIM</div>
              <h3>Claim when ready.</h3>
              <p>
                When the agent surfaces the claim link in its response, one click → permanent
                ownership. Resources <strong>inherit your team’s tier</strong>.
              </p>
              <div className="mkt-claim-card" aria-hidden="true">
                <div className="head">
                  <span className="ico" />
                  <span className="title">Provisioned <strong>postgres</strong></span>
                  <span className="countdown">23h 58m</span>
                </div>
                <div className="url">postgres://u_xY9...@pg.instanode.dev:5432/d_...</div>
                <div className="claim-btn">Claim these resources →</div>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* ---------- pricing teaser ---------- */}
      <section className="mkt-section" id="pricing-teaser">
        <div className="mkt-wrap">
          <div className="mkt-section-head">
            <div className="mkt-section-tag">Pricing · No talk-to-sales gate</div>
            <h2 className="mkt-section-title">
              Self-serve at every tier. <span className="mkt-accent">No sales call.</span>
            </h2>
            <p className="mkt-section-sub">
              Anonymous is the funnel. Hobby pays for the side project. Pro unlocks the
              multi-env workflow. Team (coming soon) is for the company that ships every day.
            </p>
          </div>

          <div className="mkt-pricing">
            {PLANS.map((p) => (
              <div
                key={p.id}
                className={`mkt-price-card ${p.id === 'anonymous' ? 'anon' : ''} ${p.featured ? 'featured' : ''}`}
              >
                {p.featured && <span className="mkt-featured-flag">Most popular</span>}
                {p.comingSoon && <span className="mkt-featured-flag mkt-soon-flag">Coming soon</span>}
                <div className="mkt-price-name">{p.name}</div>
                <p className="mkt-price-tagline">{p.tagline}</p>
                <div className="mkt-price-cost">
                  {p.price.startsWith('$') ? (
                    <>
                      <span className="currency">$</span>
                      <span className="num">{p.price.slice(1)}</span>
                    </>
                  ) : (
                    <span className="num free">{p.price}</span>
                  )}
                  <span className="freq">{p.freq}</span>
                </div>
                <ul className="mkt-price-features">
                  {p.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                {p.cta.variant === 'disabled' ? (
                  <span
                    className="btn btn-secondary"
                    aria-disabled="true"
                    style={{
                      width: '100%', justifyContent: 'center', marginTop: 'auto',
                      opacity: 0.55, cursor: 'not-allowed',
                    }}
                  >
                    {p.cta.label}
                  </span>
                ) : (
                  <a
                    href={p.cta.href}
                    className={`btn ${p.cta.variant === 'primary' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ width: '100%', justifyContent: 'center', marginTop: 'auto' }}
                  >
                    {p.cta.label}
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- for agents ---------- */}
      <section className="mkt-section mkt-agents" id="for-agents">
        <div className="mkt-wrap">
          <div className="mkt-section-head">
            <div className="mkt-section-tag">For agents</div>
            <h2 className="mkt-section-title">
              Designed for the place <span className="mkt-accent">your user actually is.</span>
            </h2>
            <p className="mkt-section-sub">
              The first surface is the agent itself — a chat card, a JSON shape, a curl line.
              Drop us into Claude Code, Cursor, or any MCP-compatible client.
            </p>
          </div>

          <div className="mkt-agent-grid">
            <div className="mkt-agent-card">
              <div className="mkt-agent-bar">
                <span className="mkt-agent-ico c" aria-hidden="true" />
                Claude Code
                <span className="mkt-agent-tag">cli</span>
              </div>
              <div className="mkt-agent-body">
                <div className="mkt-codeblock">
                  <span className="dim">// inside Claude Code chat</span>{'\n'}
                  <span style={{ color: 'var(--violet)' }}>/instanode</span>{' '}
                  spin up a postgres for the flashcards app
                </div>
                <p>Surfaces the claim card directly in chat and writes a <code>.env</code> for you.</p>
              </div>
            </div>

            <div className="mkt-agent-card">
              <div className="mkt-agent-bar">
                <span className="mkt-agent-ico m" aria-hidden="true" />
                MCP server
                <span className="mkt-agent-tag">json</span>
              </div>
              <div className="mkt-agent-body">
                <div className="mkt-codeblock">
                  <span className="dim">// claude_desktop_config.json</span>{'\n'}
                  {'{'}
                  {'\n  '}<span className="key">"mcpServers"</span>: {'{'}
                  {'\n    '}<span className="key">"instanode"</span>: {'{'}
                  {'\n      '}<span className="key">"command"</span>: <span className="str">"npx"</span>,
                  {'\n      '}<span className="key">"args"</span>: [<span className="str">"-y"</span>, <span className="str">"@instanode/mcp"</span>]
                  {'\n    '}{'}'}
                  {'\n  '}{'}'}
                  {'\n'}{'}'}
                </div>
                <p>Six tools registered: <code>postgres</code>, <code>redis</code>, <code>mongo</code>, <code>queue</code>, <code>storage</code>, <code>deploy</code>.</p>
              </div>
            </div>

            <div className="mkt-agent-card">
              <div className="mkt-agent-bar">
                <span className="mkt-agent-ico s" aria-hidden="true" />
                curl / shell
                <span className="mkt-agent-tag">sh</span>
              </div>
              <div className="mkt-agent-body">
                <div className="mkt-codeblock">
                  <span className="dim"># pipe straight into psql:</span>{'\n'}
                  <span style={{ color: 'var(--blue)' }}>psql</span>{' '}
                  <span style={{ color: 'var(--violet)' }}>$(</span>
                  <span style={{ color: 'var(--blue)' }}>curl</span>{' '}
                  <span style={{ color: 'var(--violet)' }}>-s</span>{' '}
                  api.instanode.dev/db/new
                  {'\n        '}| <span style={{ color: 'var(--blue)' }}>jq</span>{' '}
                  <span className="str">-r .connection_url</span>
                  <span style={{ color: 'var(--violet)' }}>)</span>
                </div>
                <p>One line. No SDK, no client, no setup. Cursor, Aider, and any shell-based agent work the same way.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- footer ---------- */}
      <footer className="mkt-footer">
        <div className="mkt-wrap">
          <div className="mkt-footer-top">
            <div className="mkt-footer-brand">
              <Brand />
              <p>
                Real infrastructure for AI agents. The fastest way from{' '}
                <code>npm create</code> to a live URL.
              </p>
            </div>
            <div className="mkt-footer-col">
              <h4>Product</h4>
              <a href={ROUTES.pricing}>Pricing</a>
              <a href={ROUTES.forAgents}>For agents</a>
              <a href={ROUTES.docs}>Docs</a>
              <a href={ROUTES.blog}>Blog</a>
            </div>
            <div className="mkt-footer-col">
              <h4>Legal</h4>
              <a href="/privacy">Privacy</a>
              <a href="/terms">Terms</a>
              <a href="/llms.txt">llms.txt</a>
            </div>
          </div>
          <div className="mkt-footer-bottom">
            <span>© 2026 instanode, inc.</span>
            <a href="https://status.instanode.dev" className="mkt-status-badge">
              <span className="dot" aria-hidden="true" />
              All systems normal
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}

/* ----------------------------------------------------------------
   Page-scoped CSS. All values reference variables from tokens.css —
   we never override colors, fonts, or spacing tokens.
   Class names are prefixed with `mkt-` to avoid clashes with the
   authenticated dashboard chrome.
   ---------------------------------------------------------------- */
const MKT_CSS = `
.mkt {
  background: var(--ink);
  color: var(--text);
  min-height: 100vh;
  position: relative;
  overflow: hidden;
}

/* ambient atmosphere — radial gradients + grid overlay */
.mkt::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse 800px 600px at 80% -10%, rgba(0,228,142,0.10), transparent 60%),
    radial-gradient(ellipse 1100px 700px at -10% 5%, rgba(108,206,255,0.06), transparent 55%),
    radial-gradient(ellipse 900px 800px at 50% 110%, rgba(183,148,246,0.05), transparent 50%);
  z-index: 0;
}
.mkt::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(to right, rgba(255,255,255,0.018) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255,255,255,0.018) 1px, transparent 1px);
  background-size: 64px 64px;
  -webkit-mask-image: radial-gradient(ellipse 1200px 800px at 50% 30%, black, transparent 80%);
  mask-image: radial-gradient(ellipse 1200px 800px at 50% 30%, black, transparent 80%);
  z-index: 0;
}

.mkt-wrap {
  width: 100%;
  max-width: 1320px;
  margin: 0 auto;
  padding: 0 32px;
  position: relative;
  z-index: 1;
}

/* ---------- nav ---------- */
.mkt-nav {
  position: sticky;
  top: 0;
  z-index: 50;
  background: rgba(8, 8, 10, 0.7);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-bottom: 1px solid var(--border-soft);
}
.mkt-nav-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 32px;
  gap: 32px;
}
.mkt-brand-link { display: inline-flex; align-items: center; }
.mkt-nav-links { display: flex; gap: 4px; align-items: center; }
.mkt-nav-links a {
  padding: 8px 14px;
  font-size: 14px;
  color: var(--text-dim);
  border-radius: var(--radius-sm);
  transition: color 150ms ease, background 150ms ease;
}
.mkt-nav-links a:hover { color: var(--text); background: rgba(255,255,255,0.04); }
.mkt-nav-cta { display: flex; gap: 8px; align-items: center; }

@media (max-width: 880px) {
  .mkt-nav-links { display: none; }
}
@media (max-width: 560px) {
  .mkt-hide-mobile { display: none !important; }
  .mkt-nav-inner { padding: 14px 20px; }
}

/* ---------- hero ---------- */
.mkt-hero {
  padding: 96px 0 64px;
  position: relative;
  z-index: 1;
}
.mkt-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 6px 10px;
  border: 1px solid var(--border);
  background: var(--elevated);
  border-radius: 100px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 32px;
}
.mkt-eyebrow strong { color: var(--text); font-weight: 500; }
.mkt-eyebrow .mkt-arrow { color: var(--text-faint); }
.mkt-pulse {
  width: 6px; height: 6px;
  background: var(--accent);
  border-radius: 50%;
  box-shadow: 0 0 0 0 var(--accent-glow);
  animation: mktPulse 2s infinite;
}
@keyframes mktPulse {
  0% { box-shadow: 0 0 0 0 var(--accent-glow); }
  70% { box-shadow: 0 0 0 8px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}

.mkt-h1 {
  font-family: var(--font-display);
  font-size: clamp(40px, 6.4vw, 72px);
  font-weight: 400;
  letter-spacing: -0.04em;
  line-height: 1.02;
  margin: 0 0 28px;
  max-width: 920px;
}
.mkt-accent {
  color: var(--accent);
  font-style: italic;
  font-weight: 300;
}

.mkt-hero-sub {
  font-size: 18px;
  color: var(--text-dim);
  max-width: 620px;
  line-height: 1.55;
  margin: 0 0 36px;
}
.mkt-hero-sub strong { color: var(--text); font-weight: 500; }

.mkt-hero-cta {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 64px;
}
.mkt-btn-large { padding: 14px 22px !important; font-size: 15px !important; }

/* ---------- terminal ---------- */
.mkt-terminal-stage {
  position: relative;
  max-width: 820px;
}
.mkt-terminal-glow {
  position: absolute;
  inset: -40px -10px;
  background: radial-gradient(ellipse 70% 60% at 50% 50%, var(--accent-glow), transparent 65%);
  filter: blur(40px);
  opacity: 0.35;
  z-index: 0;
  pointer-events: none;
}
.mkt-terminal {
  position: relative;
  z-index: 1;
  background: var(--code-bg);
  border: 1px dashed var(--border-hi);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: 0 1px 0 0 rgba(255,255,255,0.04) inset, 0 60px 120px -40px rgba(0,0,0,0.8);
}
.mkt-terminal-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  background: linear-gradient(180deg, #14141B, #0E0E13);
  border-bottom: 1px solid var(--border);
}
.mkt-terminal-dots { display: flex; gap: 7px; }
.mkt-terminal-dots .d {
  width: 11px; height: 11px;
  border-radius: 50%;
  background: var(--text-ghost);
}
.mkt-terminal-dots .d.r { background: #FF5F57; }
.mkt-terminal-dots .d.y { background: #FEBC2E; }
.mkt-terminal-dots .d.g { background: #28C840; }
.mkt-terminal-title {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-faint);
}
.mkt-terminal-tag {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 10.5px;
  padding: 2px 8px;
  background: rgba(0,228,142,0.06);
  color: var(--accent);
  border: 1px solid rgba(0,228,142,0.2);
  border-radius: 100px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.mkt-terminal-body {
  margin: 0;
  padding: 22px 22px 26px;
  font-family: var(--font-mono);
  font-size: 13.5px;
  line-height: 1.85;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  display: flex;
  flex-direction: column;
}
.mkt-terminal-body .line { display: block; }
.mkt-terminal-body .prompt { color: var(--accent); user-select: none; font-weight: 600; }
.mkt-terminal-body .verb { color: var(--blue); }
.mkt-terminal-body .flag { color: var(--violet); }
.mkt-terminal-body .url { color: var(--text); }
.mkt-terminal-body .out { color: var(--text-dim); }
.mkt-terminal-body .out .ok { color: var(--accent); font-weight: 600; }
.mkt-terminal-body .out .key { color: var(--text-faint); }
.mkt-terminal-body .out .str { color: var(--text); }
.mkt-terminal-body .out .num { color: var(--amber); }
.mkt-terminal-body .out .claim {
  color: var(--accent);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 4px;
}
.mkt-terminal-body .caret {
  display: inline-block;
  width: 8px; height: 1.1em;
  background: var(--accent);
  vertical-align: -3px;
  margin-left: 2px;
  animation: mktBlink 1s steps(2) infinite;
}
@keyframes mktBlink { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }

@media (max-width: 720px) {
  .mkt-terminal-body { font-size: 11.5px; padding: 16px 14px 20px; }
}

/* ---------- section scaffolding ---------- */
.mkt-section { padding: 112px 0; position: relative; z-index: 1; }
@media (max-width: 980px) { .mkt-section { padding: 72px 0; } }

.mkt-section-head { margin-bottom: 56px; max-width: 780px; }
.mkt-section-tag {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.mkt-section-tag::before {
  content: "";
  width: 6px; height: 6px;
  background: var(--accent);
  border-radius: 50%;
}
.mkt-section-title {
  font-family: var(--font-display);
  font-size: clamp(30px, 4vw, 48px);
  font-weight: 400;
  letter-spacing: -0.035em;
  line-height: 1.05;
  margin: 0 0 20px;
}
.mkt-section-sub {
  font-size: 17px;
  color: var(--text-dim);
  line-height: 1.55;
  max-width: 620px;
  margin: 0;
}

/* ---------- services row ---------- */
.mkt-services {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--surface);
}
@media (max-width: 1100px) {
  .mkt-services { grid-template-columns: repeat(4, 1fr); }
  .mkt-services .mkt-service-card:nth-child(4n) { border-right: 0; }
}
@media (max-width: 720px) {
  .mkt-services {
    grid-template-columns: max-content;
    grid-auto-flow: column;
    grid-auto-columns: 220px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
  }
  .mkt-service-card { scroll-snap-align: start; }
}
.mkt-service-card {
  padding: 24px 20px 22px;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 14px;
  transition: background 250ms ease;
  cursor: default;
  min-height: 168px;
}
.mkt-service-card:last-child { border-right: 0; }
.mkt-service-card:hover { background: var(--elevated); }
.mkt-service-card:hover .mkt-service-icon { transform: scale(1.08); }

.mkt-service-icon {
  width: 36px; height: 36px;
  border-radius: var(--radius-sm);
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  transition: transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.mkt-ico-pg { background: linear-gradient(135deg, #336791, #1c3956); color: #C4DAF0; }
.mkt-ico-rd { background: linear-gradient(135deg, #DC382D, #7a1f17); color: #FFD3CE; }
.mkt-ico-mg { background: linear-gradient(135deg, #00684A, #003d2c); color: #B7E5D5; }
.mkt-ico-qu { background: linear-gradient(135deg, #5A4FCF, #322a87); color: #D5D1F5; }
.mkt-ico-st { background: linear-gradient(135deg, #F4A261, #b56b2e); color: #2A1A0D; }
.mkt-ico-wh { background: linear-gradient(135deg, #6CCEFF, #1a6a9a); color: #082A40; }
.mkt-ico-dp { background: linear-gradient(135deg, var(--accent), #006641); color: #002817; }

.mkt-service-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
  letter-spacing: -0.01em;
}
.mkt-service-curl {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-faint);
  margin-top: -4px;
}
.mkt-service-curl .verb { color: var(--text-dim); }
.mkt-service-curl .path { color: var(--text-dim); }
.mkt-service-meta {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-dim);
}
.mkt-service-meta .spark { color: var(--accent); }
.mkt-service-meta strong { color: var(--text); font-weight: 600; }

/* ---------- how it works ---------- */
.mkt-how {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
}
@media (max-width: 980px) { .mkt-how { grid-template-columns: 1fr; } }
.mkt-how-step {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 28px;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  min-height: 420px;
}
.mkt-step-num {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-faint);
  margin-bottom: 28px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.mkt-step-num::before {
  content: "";
  width: 24px;
  height: 1px;
  background: var(--border-hi);
}
.mkt-how-step h3 {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 500;
  letter-spacing: -0.025em;
  margin: 0 0 12px;
  line-height: 1.15;
}
.mkt-how-step p {
  font-size: 14.5px;
  color: var(--text-dim);
  line-height: 1.55;
  margin: 0 0 24px;
}
.mkt-how-step p code {
  font-size: 13px;
  color: var(--text);
  background: var(--code-bg);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--border);
}
.mkt-how-step p strong { color: var(--text); font-weight: 500; }
.mkt-how-visual {
  margin-top: auto;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.7;
}
.mkt-how-visual .r { display: flex; gap: 8px; }
.mkt-how-visual .r .k { color: var(--text-faint); width: 80px; flex-shrink: 0; }
.mkt-how-visual .r .v { color: var(--text); flex: 1; }
.mkt-how-visual .r .v.dim { color: var(--text-dim); }
.mkt-how-visual .r .v.ok { color: var(--accent); }

.mkt-claim-card {
  margin-top: auto;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
}
.mkt-claim-card .head {
  display: flex; align-items: center; gap: 8px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-dim);
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px dashed var(--border);
}
.mkt-claim-card .ico {
  width: 18px; height: 18px;
  background: linear-gradient(135deg, #336791, #1c3956);
  border-radius: 4px;
  flex-shrink: 0;
}
.mkt-claim-card .title strong { color: var(--text); font-weight: 600; }
.mkt-claim-card .countdown {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--amber);
  margin-left: auto;
  padding: 2px 6px;
  background: rgba(255,192,105,0.08);
  border-radius: 4px;
}
.mkt-claim-card .url {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-dim);
  background: var(--ink);
  padding: 6px 8px;
  border-radius: 4px;
  margin-bottom: 10px;
  border: 1px solid var(--border);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mkt-claim-card .claim-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px;
  background: var(--accent);
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 12.5px;
  font-weight: 600;
  border-radius: 6px;
}

/* ---------- pricing ---------- */
.mkt-pricing {
  display: grid;
  grid-template-columns: 0.9fr 1fr 1fr 1fr;
  gap: 16px;
  align-items: stretch;
}
@media (max-width: 1080px) { .mkt-pricing { grid-template-columns: 1fr 1fr; } }
@media (max-width: 640px)  { .mkt-pricing { grid-template-columns: 1fr; } }

.mkt-price-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  position: relative;
}
.mkt-price-card.anon {
  background: transparent;
  border-style: dashed;
  border-color: var(--border-hi);
}
.mkt-price-card.featured {
  border-color: var(--accent-deep);
  background: linear-gradient(180deg, rgba(0,228,142,0.04) 0%, transparent 30%), var(--surface);
  box-shadow: 0 0 0 1px var(--accent-deep), 0 32px 64px -16px rgba(0,228,142,0.12);
}
.mkt-featured-flag {
  position: absolute;
  top: -10px;
  right: 24px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 4px 10px;
  background: var(--accent);
  color: var(--ink);
  border-radius: 100px;
}
.mkt-soon-flag {
  background: var(--amber, #f5b13c);
  color: var(--ink);
}
.mkt-price-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
  letter-spacing: -0.01em;
  margin-bottom: 4px;
}
.mkt-price-tagline {
  font-size: 13px;
  color: var(--text-dim);
  margin: 0 0 22px;
  line-height: 1.4;
}
.mkt-price-cost {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 22px;
  font-family: var(--font-display);
}
.mkt-price-cost .num {
  font-size: 44px;
  font-weight: 400;
  letter-spacing: -0.04em;
  line-height: 1;
}
.mkt-price-cost .num.free {
  color: var(--text);
  font-style: italic;
  font-weight: 300;
}
.mkt-price-cost .freq { font-size: 13px; color: var(--text-dim); }
.mkt-price-cost .currency { font-size: 22px; color: var(--text-dim); }

.mkt-price-features {
  list-style: none;
  padding: 0;
  margin: 0 0 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13.5px;
  color: var(--text-dim);
}
.mkt-price-features li {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  line-height: 1.5;
  position: relative;
  padding-left: 22px;
}
.mkt-price-features li::before {
  content: "";
  width: 14px; height: 14px;
  position: absolute;
  left: 0; top: 4px;
  border-radius: 3px;
  background: var(--elevated);
  border: 1px solid var(--border-hi);
}
.mkt-price-features li::after {
  content: "";
  position: absolute;
  left: 4px; top: 7px;
  width: 5px; height: 8px;
  border-right: 1.5px solid var(--accent);
  border-bottom: 1.5px solid var(--accent);
  transform: rotate(45deg);
}

/* ---------- for agents ---------- */
.mkt-agents { padding-top: 96px; padding-bottom: 96px; }
.mkt-agent-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}
@media (max-width: 980px) { .mkt-agent-grid { grid-template-columns: 1fr; } }
.mkt-agent-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.mkt-agent-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: var(--elevated);
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}
.mkt-agent-ico {
  width: 18px; height: 18px;
  border-radius: 4px;
  background: linear-gradient(135deg, var(--accent), #006641);
  flex-shrink: 0;
}
.mkt-agent-ico.c { background: linear-gradient(135deg, #FF6B00, #b54900); }
.mkt-agent-ico.m { background: linear-gradient(135deg, var(--violet), #6c45ce); }
.mkt-agent-ico.s { background: linear-gradient(135deg, var(--blue), #1a6a9a); }
.mkt-agent-tag {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 10.5px;
  padding: 2px 7px;
  background: var(--ink);
  color: var(--text-faint);
  border: 1px solid var(--border);
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.mkt-agent-body {
  padding: 18px 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
}
.mkt-agent-body p {
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.55;
  margin: 0;
}
.mkt-agent-body p code {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text);
  background: var(--code-bg);
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid var(--border);
}

.mkt-codeblock {
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.65;
  color: var(--text);
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  overflow-x: auto;
  white-space: pre;
}
.mkt-codeblock .dim { color: var(--text-faint); }
.mkt-codeblock .key { color: var(--blue); }
.mkt-codeblock .str { color: var(--accent); }

/* ---------- footer ---------- */
.mkt-footer {
  padding: 80px 0 40px;
  border-top: 1px solid var(--border-soft);
  position: relative;
  z-index: 1;
}
.mkt-footer-top {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 32px;
  margin-bottom: 56px;
}
@media (max-width: 720px) { .mkt-footer-top { grid-template-columns: 1fr 1fr; } }
.mkt-footer-brand p {
  font-size: 14px;
  color: var(--text-dim);
  max-width: 320px;
  margin: 16px 0 0;
  line-height: 1.5;
}
.mkt-footer-brand p code {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text);
}
.mkt-footer-col h4 {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 16px;
  font-weight: 500;
}
.mkt-footer-col a {
  display: block;
  font-size: 13.5px;
  color: var(--text-dim);
  padding: 6px 0;
  transition: color 150ms;
}
.mkt-footer-col a:hover { color: var(--text); }

.mkt-footer-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 24px;
  border-top: 1px dashed var(--border);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-faint);
  flex-wrap: wrap;
  gap: 16px;
}
.mkt-status-badge {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  padding: 5px 10px;
  background: rgba(0,228,142,0.06);
  color: var(--accent);
  border: 1px solid rgba(0,228,142,0.2);
  border-radius: 100px;
  font-size: 12px;
}
.mkt-status-badge .dot {
  width: 6px; height: 6px;
  background: var(--accent);
  border-radius: 50%;
  box-shadow: 0 0 6px var(--accent);
  animation: mktPulse 2.5s infinite;
}

/* ---------- a11y ---------- */
@media (prefers-reduced-motion: reduce) {
  .mkt *, .mkt *::before, .mkt *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
`
