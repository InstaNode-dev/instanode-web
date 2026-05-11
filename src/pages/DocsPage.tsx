/* DocsPage — public /docs.
 *
 * Single-page docs with a sidebar TOC and section anchors. Content lives in
 * the SECTIONS array below — adding a new section = one entry. No CMS.
 *
 * Security note: every code snippet here is reachable by anyone curling the
 * public domain — they are all anonymous-tier paths. Do not paste production
 * JWTs, internal cluster hostnames (*.svc.cluster.local), team_ids, or
 * AES/JWT secrets into snippets. The docs ship to the public domain. */

import { PublicShell } from '../layout/PublicShell'

type Section = {
  id: string
  title: string
  body: string // same minimal markdown subset as blog posts
}

const SECTIONS: Section[] = [
  {
    id: 'quickstart',
    title: 'Quickstart',
    body: `
The whole platform fits in one curl. No signup, no API key, no Docker.

\`\`\`
curl -X POST https://api.instanode.dev/db/new
\`\`\`

The response includes a \`connection_url\` you can paste into any Postgres
client. The database is real, dedicated, and yours for 24 hours.

When you're ready to keep it, see the **Claim flow** section below.
`
  },
  {
    id: 'services',
    title: 'The six services',
    body: `
Every endpoint returns a \`connection_url\` (or \`endpoint\` / \`receive_url\`)
plus an \`upgrade_jwt\` you can hand to /claim.

- \`POST /db/new\` — Postgres (pgvector pre-installed)
- \`POST /cache/new\` — Redis (ACL'd, per-token key prefix)
- \`POST /nosql/new\` — MongoDB
- \`POST /queue/new\` — NATS JetStream
- \`POST /storage/new\` — S3-compatible (MinIO)
- \`POST /webhook/new\` — public URL that receives any HTTP method

Every response has the same shape: \`{ ok, token, connection_url, internal_url,
tier, limits, note, upgrade_jwt }\`. \`internal_url\` is the address to use
when the caller itself runs inside our cluster (i.e. via /deploy/new) —
public hostnames don't hairpin reliably from inside.
`
  },
  {
    id: 'deploy',
    title: 'Deploying an app',
    body: `
\`POST /deploy/new\` takes a multipart form with a gzipped tar archive
containing your Dockerfile + source.

\`\`\`
curl -X POST https://api.instanode.dev/deploy/new \\
  -H "Authorization: Bearer <JWT>" \\
  -F "tarball=@app.tar.gz" \\
  -F "name=my-app" \\
  -F "port=8080" \\
  -F 'env_vars={"DATABASE_URL":"postgres://..."}'
\`\`\`

The build runs in-cluster on kaniko (~30–90s for typical Node/Python apps)
and the app rolls out behind a public HTTPS URL on
\`*.deployment.instanode.dev\` with a valid Let's Encrypt cert.

\`env_vars\` is optional — pass a JSON object and every key/value lands in
the app's environment on the first build. Saves you a follow-up PATCH+redeploy.

For multi-service apps see **Stacks** below.
`
  },
  {
    id: 'stacks',
    title: 'Stacks (multi-service deploy)',
    body: `
\`POST /stacks/new\` takes an \`instant.yaml\` manifest plus one tarball per
service. Services can reference each other with \`service://<name>\` env
values — those resolve to cluster-internal \`http://<name>:<port>\` URLs at
deploy time.

\`\`\`
services:
  api:
    build: ./api
    port: 3000
  web:
    build: ./web
    port: 8080
    expose: true
    env:
      API_URL: service://api
\`\`\`

Only services with \`expose: true\` get a public URL — the rest are
in-cluster only. The whole stack rolls out together; partial failure is
reported per-service in \`GET /stacks/{slug}\`.
`
  },
  {
    id: 'claim',
    title: 'Claim flow (anonymous → paid)',
    body: `
Anonymous resources expire in 24 hours. To keep them, claim them.

\`\`\`
RESP=$(curl -X POST https://api.instanode.dev/db/new -d '{}')
JWT=$(echo $RESP | jq -r .upgrade_jwt)

# Optional preview — shows what would attach, no side effects
curl "https://api.instanode.dev/claim/preview?t=$JWT"

# Trigger the claim — sends a magic link to your email
curl -X POST https://api.instanode.dev/claim \\
  -d "{\\"jwt\\":\\"$JWT\\", \\"email\\":\\"you@example.com\\"}"
\`\`\`

Click the magic link to set a session cookie. Every resource attached to your
fingerprint transfers to your team atomically; the connection URLs don't
change so any already-running code keeps working.

Claimed resources move to your team's tier (hobby by default — $9/mo). There
is no separate trial period on paid tiers — **the 24-hour anonymous slice
is the trial**.
`
  },
  {
    id: 'authentication',
    title: 'Authentication',
    body: `
Resource provisioning is anonymous. Everything else (deploy, vault, billing,
team management) requires a session JWT.

How to get one:

1. Provision any resource anonymously. The response includes a JWT in the
   \`upgrade_jwt\` field.
2. POST that JWT to /claim with an email. We send a magic link.
3. Click the link in the email; the page sets a session cookie.

For unattended use (CI, agents), exchange the session cookie for a long-lived
API key at \`POST /api/v1/api-keys\`. Pass it as \`Authorization: Bearer
<key>\` on every request.

To verify a token works at any time, hit \`GET /api/v1/whoami\` — returns
200 with your team_id + plan_tier on success, 401 on failure.
`
  },
  {
    id: 'limits',
    title: 'Tiers and limits',
    body: `
| Tier      | Postgres   | Redis     | MongoDB    | TTL  | Price       |
| --------- | ---------- | --------- | ---------- | ---- | ----------- |
| Anonymous | 10MB / 2c  | 5MB       | 5MB / 2c   | 24h  | free        |
| Hobby     | 1GB / 8c   | 50MB      | 1GB / 8c   | none | $9 / mo     |
| Pro       | 5GB / 20c  | 256MB     | 5GB / 20c  | none | $49 / mo    |
| Team      | coming soon | — | — | — | $199 / mo |

"c" = simultaneous connections. The full table is at \`/pricing\`.

Limits are enforced at the Postgres user level (\`CONNECTION LIMIT\` on the
role) and via per-bucket storage quotas. Exceeding a limit returns a 402 with
an upgrade URL — your app keeps running, the next provision just fails.
`
  },
  {
    id: 'machine-readable',
    title: 'Machine-readable API',
    body: `
The full API surface is described in OpenAPI 3.1 at:

\`\`\`
https://api.instanode.dev/openapi.json
\`\`\`

It is the source of truth for paths, schemas, security schemes, and which
endpoints accept anonymous traffic. Agents reading this spec alone can
discover the claim flow (described under \`securitySchemes.bearerAuth\`),
the \`/api/v1/whoami\` identity probe, and which fields like \`upgrade_jwt\`
to pass forward.

If you're an AI agent reading this, the recommended bootstrap is:

1. \`GET /openapi.json\`
2. Provision anonymous resources
3. \`GET /api/v1/whoami\` to confirm token validity once you have one
`
  }
]

export function DocsPage() {
  return (
    <PublicShell>
      <DocsStyles />
      <div className="docs-wrap">
        <aside className="docs-toc" aria-label="Documentation sections">
          <p className="docs-toc-label">Docs</p>
          <ol>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
          </ol>
          <p className="docs-toc-foot">
            Full API ref:{' '}
            <a href="https://api.instanode.dev/openapi.json" target="_blank" rel="noopener noreferrer">
              openapi.json ↗
            </a>
          </p>
        </aside>

        <article className="docs-main">
          <header className="docs-hero">
            <h1>Documentation</h1>
            <p>Everything you need to provision, deploy, and claim. Every curl below works as-is.</p>
          </header>

          {SECTIONS.map((s) => (
            <section key={s.id} id={s.id} className="docs-section">
              <h2>
                <a href={`#${s.id}`} className="docs-section-anchor">
                  {s.title}
                </a>
              </h2>
              <div className="docs-section-body">{renderDocsMarkdown(s.body, s.id)}</div>
            </section>
          ))}
        </article>
      </div>
    </PublicShell>
  )
}

// Same minimal markdown handling as BlogPostPage, kept self-contained so the
// pages don't share a parser yet (premature abstraction; revisit if a third
// page wants the same rendering).
function renderDocsMarkdown(md: string, sectionID: string): React.ReactNode {
  const blocks = md.trim().split(/\n\n+/)
  return blocks.map((block, i) => {
    const key = `${sectionID}-${i}`
    if (block.startsWith('### ')) return <h3 key={key}>{inline(block.slice(4))}</h3>
    if (block.startsWith('## ')) return <h3 key={key}>{inline(block.slice(3))}</h3>
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
    if (block.startsWith('|')) return <pre key={key} className="docs-table"><code>{block}</code></pre>
    return <p key={key}>{inline(block)}</p>
  })
}

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

function DocsStyles() {
  return (
    <style>{`
      .docs-wrap { max-width: 1080px; margin: 0 auto; padding: 40px 24px 80px; display: grid; grid-template-columns: 220px 1fr; gap: 48px; }
      @media (max-width: 760px) { .docs-wrap { grid-template-columns: 1fr; } .docs-toc { position: static; } }
      .docs-toc { position: sticky; top: 88px; align-self: start; font-size: 14px; }
      .docs-toc-label { color: var(--text-dim); margin: 0 0 12px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
      .docs-toc ol { list-style: none; padding: 0; margin: 0 0 24px; display: grid; gap: 4px; }
      .docs-toc a { color: var(--text-dim); text-decoration: none; padding: 4px 0; display: block; }
      .docs-toc a:hover { color: var(--accent); }
      .docs-toc-foot { font-size: 13px; color: var(--text-dim); }
      .docs-toc-foot a { color: var(--accent); }
      .docs-main { min-width: 0; }
      .docs-hero h1 { font-size: 40px; margin: 0 0 12px; letter-spacing: -0.02em; }
      .docs-hero p { color: var(--text-dim); font-size: 18px; line-height: 1.5; margin: 0 0 48px; }
      .docs-section { margin: 0 0 56px; }
      .docs-section h2 { font-size: 26px; margin: 0 0 16px; letter-spacing: -0.015em; }
      .docs-section-anchor { color: inherit; text-decoration: none; }
      .docs-section-anchor:hover::before { content: '# '; color: var(--accent); }
      .docs-section-body { font-size: 16px; line-height: 1.65; color: var(--text); }
      .docs-section-body h3 { font-size: 18px; margin: 28px 0 8px; }
      .docs-section-body p { margin: 0 0 16px; }
      .docs-section-body ul { margin: 0 0 16px; padding-left: 24px; }
      .docs-section-body li { margin: 6px 0; }
      .docs-section-body code { background: var(--ink); border: 1px solid var(--border); color: var(--text); padding: 1px 6px; border-radius: 4px; font-size: 13.5px; font-family: var(--font-mono); }
      .docs-section-body pre { background: var(--code-bg); color: var(--text); border: 1px solid var(--border); padding: 16px 20px; border-radius: 8px; overflow-x: auto; font-size: 13px; line-height: 1.55; margin: 16px 0; }
      .docs-section-body pre code { background: transparent; padding: 0; color: inherit; }
      .docs-section-body pre.docs-table { background: transparent; color: inherit; padding: 0; font-size: 14px; }
      .docs-section-body strong { font-weight: 600; }
    `}</style>
  )
}
