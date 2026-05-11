/* UseCasesPage — public /use-cases.
 *
 * Catalog of 50 unique scenarios where instanode.dev fits. Grouped by the
 * archetype of the builder (AI coding agent, multi-agent system, vertical
 * AI app, etc.) so a reader can find themselves in <10 seconds.
 *
 * Pre-rendered to dist/use-cases/index.html at build time by
 * scripts/prerender.mjs. Crawlers see every case name + scenario without
 * executing JS.
 *
 * Wrapped in PublicShell. */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PublicShell } from '../layout/PublicShell'
import { USE_CASES, type Category, type Service } from '../content/useCases'

const SERVICE_LABEL: Record<Service, string> = {
  pg: 'Postgres',
  redis: 'Redis',
  mongo: 'MongoDB',
  nats: 'NATS',
  minio: 'MinIO',
  webhook: 'Webhook',
  deploy: 'Deploy',
}

const ALL_FILTER = 'all' as const

export function UseCasesPage() {
  const [filter, setFilter] = useState<typeof ALL_FILTER | Category>(ALL_FILTER)

  const categories = useMemo<Category[]>(() => {
    const set = new Set<Category>()
    for (const c of USE_CASES) set.add(c.category)
    return Array.from(set).sort()
  }, [])

  const filtered = useMemo(() => {
    if (filter === ALL_FILTER) return USE_CASES
    return USE_CASES.filter((c) => c.category === filter)
  }, [filter])

  const grouped = useMemo(() => {
    const map = new Map<Category, typeof USE_CASES>()
    for (const c of filtered) {
      const list = map.get(c.category) ?? []
      list.push(c)
      map.set(c.category, list)
    }
    return Array.from(map.entries())
  }, [filtered])

  return (
    <PublicShell>
      <UseCasesStyles />
      <div className="uc-wrap">
        <header className="uc-hero">
          <h1>Fifty places instanode.dev fits</h1>
          <p className="uc-sub">
            From terminal-resident coding agents that need cross-session memory to
            hackathon teams that need a backend in three curls. Each case lists the
            services that make it work — provision each in under a second, claim
            when you're ready.
          </p>
        </header>

        <nav className="uc-filters" aria-label="Filter by category">
          <button
            type="button"
            className={`uc-chip ${filter === ALL_FILTER ? 'uc-chip-on' : ''}`}
            onClick={() => setFilter(ALL_FILTER)}
          >
            All {USE_CASES.length}
          </button>
          {categories.map((c) => {
            const n = USE_CASES.filter((u) => u.category === c).length
            return (
              <button
                key={c}
                type="button"
                className={`uc-chip ${filter === c ? 'uc-chip-on' : ''}`}
                onClick={() => setFilter(c)}
              >
                {c.replace(/^[A-Z]\.\s*/, '')} <span className="uc-chip-count">{n}</span>
              </button>
            )
          })}
        </nav>

        <div className="uc-groups">
          {grouped.map(([cat, list]) => (
            <section key={cat} className="uc-group">
              <h2 className="uc-group-title">{cat}</h2>
              <ul className="uc-list">
                {list.map((u) => (
                  <li key={u.slug} className="uc-card">
                    <Link to={`/use-cases/${u.slug}`} className="uc-card-link">
                      <h3 className="uc-card-title">{u.title}</h3>
                      <p className="uc-card-scenario">{u.scenario}</p>
                      <div className="uc-card-services" aria-label="Services used">
                        {u.services.map((s) => (
                          <span key={s} className="uc-service-tag">{SERVICE_LABEL[s]}</span>
                        ))}
                      </div>
                      <span className="uc-card-cta">See how →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <footer className="uc-foot">
          <p>Don't see your shape? The platform is one curl. Try it on yours.</p>
          <a href="/docs#quickstart" className="uc-foot-cta">Quickstart →</a>
        </footer>
      </div>
    </PublicShell>
  )
}

function UseCasesStyles() {
  return (
    <style>{`
      .uc-wrap { max-width: 1080px; margin: 0 auto; padding: 56px 24px 80px; }
      .uc-hero h1 { font-size: 40px; margin: 0 0 12px; letter-spacing: -0.02em; }
      .uc-sub { color: var(--text-dim); font-size: 18px; line-height: 1.5; margin: 0 0 32px; max-width: 720px; }

      .uc-filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 40px; }
      .uc-chip {
        appearance: none; border: 1px solid var(--border-hi);
        background: transparent; padding: 6px 12px; border-radius: 999px;
        font-size: 13px; cursor: pointer; color: var(--text);
        transition: background 120ms, border-color 120ms;
      }
      .uc-chip:hover { border-color: var(--accent); color: var(--text); }
      .uc-chip-on { background: var(--accent); border-color: var(--accent); color: var(--ink); }
      .uc-chip-count { opacity: 0.7; margin-left: 4px; font-variant-numeric: tabular-nums; }

      .uc-groups { display: grid; gap: 48px; }
      .uc-group-title {
        font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em;
        color: var(--text-dim); margin: 0 0 16px; font-weight: 600;
      }
      .uc-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
      .uc-card {
        border: 1px solid var(--border-hi); border-radius: 10px;
        transition: border-color 120ms, transform 120ms;
      }
      .uc-card:hover { border-color: var(--accent); transform: translateY(-1px); }
      .uc-card-link {
        display: flex; flex-direction: column; gap: 8px;
        padding: 20px; text-decoration: none; color: inherit;
        height: 100%;
      }
      .uc-card-title { font-size: 16px; margin: 0; letter-spacing: -0.005em; color: var(--text); }
      .uc-card-scenario { color: var(--text-dim); font-size: 14px; line-height: 1.5; margin: 0; flex: 1; }
      .uc-card-cta { color: var(--accent); font-size: 13px; font-weight: 500; margin-top: 4px; }
      .uc-card-services { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
      .uc-service-tag {
        font-size: 11px; padding: 2px 8px; border-radius: 4px;
        background: var(--ink); color: var(--text-dim); border: 1px solid var(--border);
        font-family: var(--font-mono);
      }

      .uc-foot { margin-top: 64px; padding-top: 32px; border-top: 1px solid var(--border-hi); text-align: center; }
      .uc-foot p { color: var(--text-dim); margin: 0 0 12px; }
      .uc-foot-cta { color: var(--accent); text-decoration: none; font-weight: 500; font-size: 16px; }
    `}</style>
  )
}
