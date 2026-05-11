/* UseCaseDetailPage — /use-cases/:slug.
 *
 * Each of the 100+ scenarios on /use-cases gets its own detail page.
 * Most cases auto-generate their detail content from the data in the
 * frontmatter (scenario, services). When a case has hand-authored body
 * content in its .md file, that content renders after the auto-generated
 * "How to set it up" section.
 *
 * Pre-rendered to dist/use-cases/<slug>/index.html at build time by
 * scripts/prerender.mjs so crawlers see every detail without executing
 * JS. */

import { useParams, Link } from 'react-router-dom'
import { PublicShell } from '../layout/PublicShell'
import { getUseCaseBySlug, type Service, type UseCase } from '../content/useCases'
import { renderMarkdown } from '../lib/markdown'

/* Per-service display data used by the auto-generated "How to set it
 * up" section. Each entry: human label + a one-line description of what
 * the curl call gets you. */
const SERVICE_INFO: Record<Service, { label: string; curl: string; gets: string }> = {
  pg: {
    label: 'Postgres',
    curl: 'curl -X POST https://api.instanode.dev/db/new',
    gets: 'A real, dedicated Postgres database with pgvector pre-installed. Connection URL returned in ~1 second.',
  },
  redis: {
    label: 'Redis',
    curl: 'curl -X POST https://api.instanode.dev/cache/new',
    gets: 'A namespaced Redis instance with per-token ACLs. Connection URL returned in ~500 ms.',
  },
  mongo: {
    label: 'MongoDB',
    curl: 'curl -X POST https://api.instanode.dev/nosql/new',
    gets: 'A dedicated MongoDB user + database. Connection URL returned in ~1 second.',
  },
  nats: {
    label: 'NATS JetStream',
    curl: 'curl -X POST https://api.instanode.dev/queue/new',
    gets: 'A NATS JetStream client URL and per-token credentials. Durable subjects, request/reply, pub/sub.',
  },
  minio: {
    label: 'MinIO (S3)',
    curl: 'curl -X POST https://api.instanode.dev/storage/new',
    gets: 'An S3-compatible bucket with per-token IAM user. Standard AWS SDKs work as-is.',
  },
  webhook: {
    label: 'Webhook receiver',
    curl: 'curl -X POST https://api.instanode.dev/webhook/new',
    gets: 'A public receive URL that captures any HTTP method. Inspect payloads at GET /webhooks/<token>/requests.',
  },
  deploy: {
    label: 'Container deploy',
    curl: 'curl -X POST https://api.instanode.dev/deploy/new -F tarball=@app.tar.gz',
    gets: 'A kaniko build runs in-cluster; your app rolls out behind a public *.deployment.instanode.dev HTTPS URL.',
  },
}

export function UseCaseDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const useCase = slug ? getUseCaseBySlug(slug) : undefined

  if (!useCase) return <NotFound />
  return <Detail useCase={useCase} />
}

function NotFound() {
  return (
    <PublicShell>
      <DetailStyles />
      <div className="ucd-wrap">
        <p className="ucd-back"><Link to="/use-cases">← All use cases</Link></p>
        <h1>Use case not found</h1>
        <p>We don't have a case at that URL. Try the <Link to="/use-cases">full catalogue</Link>.</p>
      </div>
    </PublicShell>
  )
}

function Detail({ useCase }: { useCase: UseCase }) {
  return (
    <PublicShell>
      <DetailStyles />
      <article className="ucd-wrap">
        <p className="ucd-back"><Link to="/use-cases">← All use cases</Link></p>

        <header className="ucd-head">
          <p className="ucd-category">{useCase.category}</p>
          <h1>{useCase.title}</h1>
          <p className="ucd-scenario">{useCase.scenario}</p>
        </header>

        {useCase.body ? (
          <div className="ucd-body">
            {renderMarkdown(useCase.body, { baseHeading: 'h2', keyPrefix: useCase.slug })}
          </div>
        ) : (
          /* Fallback for cases without a hand-authored body. Today every
           * case has one; this branch exists for resilience if a new
           * case ships in the content repo before its body is written. */
          <AutoDetail services={useCase.services} />
        )}

        <footer className="ucd-foot">
          <p>Ready to try it?</p>
          <pre className="ucd-cta-curl"><code>{primaryCurl(useCase.services)}</code></pre>
          <p className="ucd-cta-note">
            Or browse <Link to="/use-cases">all 100+ scenarios</Link> · read{' '}
            <Link to="/docs">the docs</Link> · open the{' '}
            <a href="https://api.instanode.dev/openapi.json">OpenAPI spec ↗</a>
          </p>
        </footer>
      </article>
    </PublicShell>
  )
}

/* AutoDetail — fallback section block rendered only when a use case
 * ships without a hand-authored body. Lists the curls per service and
 * a generic value-prop bullet list — enough that the page is useful
 * even for an un-authored case. Once a body lands in the content repo
 * for the slug, this fallback is hidden and the body takes over. */
function AutoDetail({ services }: { services: Service[] }) {
  return (
    <>
      {services.length > 0 && (
        <section className="ucd-section">
          <h2>How to set it up</h2>
          <p className="ucd-section-lede">
            This scenario uses {services.length}{' '}
            {services.length === 1 ? 'service' : 'services'} from instanode.dev.
            Each is one HTTP call to provision — no signup, no Docker.
          </p>
          <ol className="ucd-steps">
            {services.map((s, i) => {
              const info = SERVICE_INFO[s]
              return (
                <li key={s} className="ucd-step">
                  <p className="ucd-step-title">
                    <span className="ucd-step-num">{i + 1}.</span> Provision {info.label}
                  </p>
                  <p className="ucd-step-gets">{info.gets}</p>
                  <pre className="ucd-step-curl"><code>{info.curl}</code></pre>
                </li>
              )
            })}
            <li className="ucd-step">
              <p className="ucd-step-title">
                <span className="ucd-step-num">{services.length + 1}.</span> Wire your agent or app to the returned connection URLs
              </p>
              <p className="ucd-step-gets">
                Every response includes a <code>connection_url</code> (or <code>receive_url</code> for
                webhooks, <code>endpoint</code> for storage) plus an <code>upgrade_jwt</code> you can
                hand to <code>/claim</code> when you want to keep the resource past the 24-hour
                anonymous window.
              </p>
            </li>
          </ol>
        </section>
      )}

      <section className="ucd-section">
        <h2>Why this is useful</h2>
        <ul className="ucd-bullets">
          <li>
            <strong>Zero ceremony.</strong> No signup, no API key, no Docker, no cloud account.
            The first call returns a real resource in under a second.
          </li>
          <li>
            <strong>Anonymous-first.</strong> The 24-hour anonymous tier is the trial — every
            resource expires unless you claim it. No credit card needed to try.
          </li>
          <li>
            <strong>Real infrastructure, not a sandbox.</strong> Every Postgres is a real
            Postgres, every Redis a real Redis. Your code that works on instanode.dev works
            against any standard hosted version when you migrate.
          </li>
          <li>
            <strong>Designed for agents.</strong> Single HTTP calls fit in muscle memory for
            LLM tool use. Predictable JSON responses, OpenAPI 3.1 spec at <code>/openapi.json</code>.
          </li>
        </ul>
      </section>
    </>
  )
}

function primaryCurl(services: Service[]): string {
  if (services.length === 0) return 'curl -X POST https://api.instanode.dev/db/new'
  return SERVICE_INFO[services[0]].curl
}

function DetailStyles() {
  return (
    <style>{`
      .ucd-wrap { max-width: 760px; margin: 0 auto; padding: 40px 24px 80px; }
      .ucd-back a { color: var(--text-dim); text-decoration: none; font-size: 14px; }
      .ucd-back a:hover { color: var(--accent); }

      .ucd-head { margin: 24px 0 40px; padding-bottom: 24px; border-bottom: 1px solid var(--border-hi); }
      .ucd-category {
        font-family: var(--font-mono); font-size: 11px;
        color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.06em;
        margin: 0 0 8px;
      }
      .ucd-head h1 {
        font-size: 32px; margin: 0 0 14px; letter-spacing: -0.02em;
        line-height: 1.2; color: var(--text);
      }
      .ucd-scenario { color: var(--text-dim); font-size: 16px; line-height: 1.6; margin: 0; }

      .ucd-section { margin: 40px 0; }
      .ucd-section h2 {
        font-size: 22px; margin: 0 0 14px; letter-spacing: -0.01em; color: var(--text);
      }
      .ucd-section-lede { color: var(--text-dim); font-size: 14px; line-height: 1.55; margin: 0 0 20px; }

      .ucd-steps { list-style: none; padding: 0; margin: 0; display: grid; gap: 16px; }
      .ucd-step {
        border: 1px solid var(--border-hi); border-radius: 8px; padding: 16px 18px;
        background: var(--surface);
      }
      .ucd-step-title { font-size: 15px; font-weight: 500; margin: 0 0 6px; color: var(--text); }
      .ucd-step-num { color: var(--accent); margin-right: 6px; font-family: var(--font-mono); }
      .ucd-step-gets { color: var(--text-dim); font-size: 14px; line-height: 1.55; margin: 0 0 12px; }
      .ucd-step-curl {
        background: var(--code-bg); color: var(--text); border: 1px solid var(--border);
        padding: 10px 14px; border-radius: 6px; overflow-x: auto;
        font-size: 12.5px; font-family: var(--font-mono); margin: 0;
      }
      .ucd-step-curl code { background: transparent; padding: 0; border: 0; color: inherit; font-family: inherit; }

      .ucd-bullets { color: var(--text-dim); font-size: 15px; line-height: 1.65; padding-left: 22px; }
      .ucd-bullets li { margin: 0 0 10px; }
      .ucd-bullets strong { color: var(--text); font-weight: 600; }

      .ucd-body { color: var(--text); font-size: 15px; line-height: 1.65; margin: 40px 0; }
      .ucd-body h2 { font-size: 22px; margin: 40px 0 14px; letter-spacing: -0.01em; color: var(--text); }
      .ucd-body h3 { font-size: 18px; margin: 24px 0 8px; color: var(--text); }
      .ucd-body h4 { font-size: 15px; margin: 18px 0 6px; color: var(--text); }
      .ucd-body p { margin: 0 0 14px; }
      .ucd-body code {
        background: var(--ink); border: 1px solid var(--border); color: var(--text);
        padding: 1px 6px; border-radius: 4px; font-size: 13.5px; font-family: var(--font-mono);
      }
      .ucd-body pre {
        background: var(--code-bg); color: var(--text); border: 1px solid var(--border);
        padding: 14px 18px; border-radius: 8px; overflow-x: auto;
        font-size: 13px; line-height: 1.55; margin: 14px 0;
        font-family: var(--font-mono);
      }
      .ucd-body pre code { background: transparent; padding: 0; border: 0; color: inherit; }
      .ucd-body ul { padding-left: 22px; margin: 0 0 16px; }
      .ucd-body li { margin: 6px 0; }

      .ucd-foot {
        margin-top: 56px; padding-top: 32px;
        border-top: 1px solid var(--border-hi); text-align: center;
      }
      .ucd-foot p { color: var(--text-dim); font-size: 14px; margin: 0 0 12px; }
      .ucd-cta-curl {
        display: inline-block; max-width: 100%;
        background: var(--code-bg); color: var(--text); border: 1px solid var(--border);
        padding: 12px 18px; border-radius: 8px; overflow-x: auto;
        font-size: 13px; font-family: var(--font-mono); margin: 0 auto 18px;
        text-align: left;
      }
      .ucd-cta-curl code { background: transparent; padding: 0; border: 0; color: inherit; font-family: inherit; }
      .ucd-cta-note { font-size: 13px; color: var(--text-dim); }
      .ucd-cta-note a { color: var(--accent); text-decoration: none; }
      .ucd-cta-note a:hover { text-decoration: underline; }
    `}</style>
  )
}
