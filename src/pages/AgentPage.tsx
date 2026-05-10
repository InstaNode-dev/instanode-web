import { useState } from 'react'
import { ContractBanner, Card, ResourceIcon } from '../components/Common'

interface Prompt {
  name: string
  api: string
  example: React.ReactNode
  blocked?: boolean
  sudo?: boolean
}
interface Group {
  title: string
  iconType?: 'postgres' | 'deploy' | 'mongodb' | null
  iconNode?: React.ReactNode
  blocked?: boolean
  prompts: Prompt[]
}

const GROUPS: Group[] = [
  {
    title: 'resources · 7 prompts',
    iconType: 'postgres',
    prompts: [
      { name: 'Provision Postgres',  api: 'POST api.instanode.dev/db/new',          example: <>"Spin up a Postgres for the <em>flashcards</em> app, prod env."</> },
      { name: 'Provision Redis',     api: 'POST api.instanode.dev/cache/new',       example: <>"Add a Redis cache, 256 MB, prod."</> },
      { name: 'Rotate credentials',  api: 'POST /api/v1/resources/:id/rotate',      example: <>"Rotate the password for <em>flashcards-db</em>."</> },
      { name: 'Delete resource',     api: 'DELETE /api/v1/resources/:id',           example: <>"Delete the staging copy of <em>events-store</em>."</> },
      { name: 'List resources',      api: 'GET /api/v1/resources',                  example: <>"What resources do I have in prod?"</> },
      { name: 'Inspect connection',  api: 'GET /api/v1/resources/:id',              example: <>"Give me the connection URL for <em>flashcards-db</em>."</> },
      { name: 'Provision env-scoped', api: 'POST /db/new?env=staging',              example: <>"Make a staging copy of <em>flashcards-db</em>."</> }
    ]
  },
  {
    title: 'deployments · 6 prompts',
    iconType: 'deploy',
    prompts: [
      { name: 'Deploy app',     api: 'POST /deploy/new (multipart)',           example: <>"Deploy <em>./flashcards</em> to prod, port 3000."</> },
      { name: 'Redeploy',       api: 'POST /api/v1/stacks/:slug/redeploy',     example: <>"Redeploy <em>flashcards</em> with the latest commit."</> },
      { name: 'Rollback',       api: 'POST /api/v1/stacks/:slug/rollback',     example: <>"Roll <em>flashcards</em> back to the last healthy build."</> },
      { name: 'Stop',           api: 'POST /api/v1/stacks/:slug/stop',         example: <>"Stop the <em>worker</em> deployment."</> },
      { name: 'Update env vars', api: 'PATCH /api/v1/stacks/:slug',             example: <>"Set <em>NODE_ENV=staging</em> on flashcards and redeploy."</> },
      { name: 'Tail logs',      api: 'GET /api/v1/stacks/:slug/logs (SSE)',    example: <>"Tail the logs for <em>flashcards</em>."</> }
    ]
  },
  {
    title: 'vault · 4 prompts · blocked until contract locks',
    iconNode: (
      <span
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 9,
          width: 16, height: 16, borderRadius: 3,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--ink)', border: '1px solid rgba(255,122,138,0.2)',
          color: 'var(--rose)'
        }}
      >⚷</span>
    ),
    blocked: true,
    prompts: [
      { name: 'Add secret',     api: 'PUT /api/v1/vault/:env/:key',            example: <>"Put <em>STRIPE_SECRET_KEY</em> in the prod vault."</> },
      { name: 'Rotate',         api: 'PUT /api/v1/vault/:env/:key',            example: <>"Rotate <em>OPENAI_API_KEY</em> in prod with this new value."</> },
      { name: 'Bind to deploy', api: 'PATCH /api/v1/stacks/:slug',             example: <>"Wire <em>STRIPE_SECRET_KEY</em> into the flashcards deploy."</> },
      { name: 'Reveal (sudo)',  api: 'POST /api/v1/vault/:env/:key/reveal',    example: <>"Show me the value of <em>STRIPE_SECRET_KEY</em>."</>, sudo: true }
    ]
  },
  {
    title: 'team · 4 prompts',
    iconNode: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--text-dim)" strokeWidth={1.5}>
        <circle cx="5" cy="5" r="2.5" />
        <circle cx="10" cy="5" r="2" />
        <path d="M1 12c0-2.2 1.8-4 4-4s4 1.8 4 4" />
      </svg>
    ),
    prompts: [
      { name: 'Invite teammate', api: 'POST /api/v1/team/members/invite',         example: <>"Invite <em>kavya@acme.dev</em> as a developer."</> },
      { name: 'Promote / demote', api: 'PATCH /api/v1/team/members/:id (not yet)', example: <>"Promote <em>kavya</em> to admin."</> },
      { name: 'Remove member',   api: 'DELETE /api/v1/team/members/:id',          example: <>"Remove <em>arjun@external.io</em> from the team."</> },
      { name: 'Revoke invite',   api: 'DELETE /api/v1/team/invitations/:id',      example: <>"Cancel the pending invite to <em>priya@acme.dev</em>."</> }
    ]
  }
]

export function AgentPage() {
  const [search, setSearch] = useState('rotate fla')

  return (
    <>
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 28, fontWeight: 400, letterSpacing: '-0.03em', marginBottom: 8 }}>
          Ask your <span style={{ color: 'var(--violet)', fontStyle: 'italic', fontWeight: 300 }}>agent.</span>
        </h2>
        <p style={{ fontSize: 14, color: 'var(--text-dim)', maxWidth: 760, lineHeight: 1.55 }}>
          The dashboard is read-only. Every action — provision, rotate, deploy, invite, edit secrets — is a prompt to your agent. The agent calls the API. The dashboard reflects the result. <strong style={{ color: 'var(--text)' }}>Billing is the only exception</strong> (cards need a human).
        </p>
      </div>

      <Strip />

      <h3 style={{ fontSize: 16, fontWeight: 500, marginTop: 32, marginBottom: 14 }}>Command palette · ⌘K</h3>

      <Palette search={search} setSearch={setSearch} />

      <div className="section-h" style={{ marginTop: 40 }}>
        <h2>Prompt library</h2>
        <span className="sub">copy · paste into any agent · or use ⌘K to send directly</span>
      </div>

      {GROUPS.map((g) => (
        <Card key={g.title} style={{ padding: 0, marginBottom: 16 }}>
          <div style={{
            padding: '12px 16px', borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex', gap: 10, alignItems: 'center'
          }}>
            {g.iconType ? <ResourceIcon type={g.iconType} size={16} /> : g.iconNode}
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)',
              textTransform: 'uppercase', letterSpacing: '0.06em'
            }}>
              {g.title.replace(/blocked until contract locks/, '')}
              {g.blocked && <span style={{ color: 'var(--rose)' }}> · blocked until contract locks</span>}
            </span>
          </div>
          {g.prompts.map((p) => (
            <div key={p.name} className="lib-row" style={g.blocked ? { opacity: 0.65 } : undefined}>
              <div className="lbl">
                <span className="name">{p.name}</span>
                <span className="api">{p.api}</span>
              </div>
              <span className="ex">
                {p.example}
                {p.sudo && <span style={{ color: 'var(--amber)' }}> · requires sudo re-auth</span>}
              </span>
              <button className="copy-tiny">copy ↗</button>
            </div>
          ))}
        </Card>
      ))}

      <ContractBanner kind="warning" badge="human only">
        <strong>Billing, claim, and sign-in stay clickable.</strong> Cards belong to humans. Identity binding (claim, magic link) is the moment a human decides to "own" something. Everything else — including <em>"talk to your agent before you click"</em> — belongs in the agent.
      </ContractBanner>
    </>
  )
}

function Strip() {
  const cells = [
    { lbl: 'read',     color: 'var(--text-faint)', strong: 'Dashboard.', body: 'Resources, deploys, vault keys (masked), team, audit trails — everything the API knows.' },
    { lbl: 'write',    color: 'var(--violet)',     strong: 'Agent.',     body: 'Provision, rotate, deploy, env-vars, vault, invites, role changes — all by prompt.' },
    { lbl: 'human-only', color: 'var(--amber)',    strong: 'Billing & auth.', body: 'Card entry, plan change, claim, sign-in. Identity + payment can\'t be agent-driven.' },
    { lbl: 'contract', color: 'var(--text-faint)', strong: 'Every prompt → one API call.', body: 'No hidden orchestration. Agent uses the same endpoints we publish.' }
  ]
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      overflow: 'hidden',
      background: 'var(--surface)',
      marginBottom: 32
    }}>
      {cells.map((c, i) => (
        <div key={c.lbl} style={{
          padding: '18px 20px',
          borderRight: i < cells.length - 1 ? '1px solid var(--border)' : 0
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10.5, color: c.color,
            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10
          }}>
            {c.lbl}
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.4, color: 'var(--text)' }}>
            <strong>{c.strong}</strong> <span style={{ color: 'var(--text-dim)' }}>{c.body}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function Palette({ search, setSearch }: { search: string; setSearch: (v: string) => void }) {
  const matches = [
    { kind: 'DO',  bg: 'var(--violet)', match: <>Rotate the credentials for <em style={{ color: 'var(--violet)', fontStyle: 'normal', fontWeight: 600 }}>flashcards-db</em></>, api: 'POST /resources/d_xY9z2k7m/rotate', highlighted: true },
    { kind: 'DO',  bg: 'var(--rose)',   match: <>Delete <em style={{ color: 'var(--text)', fontStyle: 'normal', fontWeight: 500 }}>flashcards-db</em></>, api: 'DELETE /resources/d_xY9z2k7m' },
    { kind: 'SEE', bg: 'var(--accent)', match: <>Open <em style={{ color: 'var(--text)', fontStyle: 'normal', fontWeight: 500 }}>flashcards-db</em> detail</>, api: '→ /resources/d_xY9z2k7m' },
    { kind: 'DO',  bg: 'var(--blue)',   match: <>Redeploy <em style={{ color: 'var(--text)', fontStyle: 'normal', fontWeight: 500 }}>flashcards</em></>, api: 'POST /stacks/flashcards/redeploy' }
  ]
  return (
    <div style={{
      border: '1px solid var(--border-hi)',
      borderRadius: 14,
      background: 'var(--surface)',
      overflow: 'hidden',
      maxWidth: 760,
      boxShadow: '0 24px 48px -16px rgba(0,0,0,0.6)'
    }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ color: 'var(--violet)', fontSize: 14 }}>✦</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1, background: 'transparent', border: 0, outline: 0,
            fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--text)',
            letterSpacing: '-0.01em'
          }}
          placeholder="describe what you want…"
        />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}>
          claude code · connected
        </span>
      </div>
      <div style={{ padding: '8px 6px' }}>
        {matches.map((m, i) => (
          <div key={i}
            style={{
              padding: '10px 12px', display: 'flex', gap: 12, alignItems: 'center',
              background: m.highlighted ? 'rgba(183,148,246,0.06)' : 'transparent',
              borderRadius: 6, cursor: 'pointer'
            }}>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, padding: '3px 7px',
              background: m.bg, color: 'var(--ink)', borderRadius: 3, letterSpacing: '0.05em', fontWeight: 600
            }}>
              {m.kind}
            </span>
            <span style={{ fontSize: 13.5, color: m.highlighted ? 'var(--text)' : 'var(--text-dim)', fontStyle: 'italic' }}>
              {m.match}
            </span>
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)' }}>
              {m.api}
            </span>
          </div>
        ))}
      </div>
      <div style={{
        padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--ink)',
        display: 'flex', alignItems: 'center', gap: 12,
        fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)'
      }}>
        <span><Kbd>↩</Kbd> send to agent</span>
        <span><Kbd>⌘</Kbd> + <Kbd>↩</Kbd> copy curl</span>
        <span style={{ marginLeft: 'auto' }}>connected to claude-code · localhost:7331</span>
      </div>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        fontFamily: 'var(--font-mono)', fontSize: 10, padding: '1px 5px',
        background: 'var(--surface)', border: '1px solid var(--border-hi)',
        borderRadius: 3, color: 'var(--text-dim)'
      }}
    >
      {children}
    </kbd>
  )
}
