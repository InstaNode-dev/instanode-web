import { ContractBanner, ContractLine, Card } from '../components/Common'

export function ContractsPage() {
  return (
    <>
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 28, fontWeight: 400, letterSpacing: '-0.03em', marginBottom: 8 }}>
          API contracts &amp; gaps
        </h2>
        <p style={{ fontSize: 14, color: 'var(--text-dim)', maxWidth: 760, lineHeight: 1.55 }}>
          Inventory of every endpoint the dashboard touches — what's locked, what's blocked, what's contradicted between brief and code. Lock the gaps below before backend &amp; frontend ship in parallel.
        </p>
      </div>

      <div className="stats" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <SummaryStat color="accent" label="locked" v="26" sub="endpoints live" />
        <SummaryStat color="rose"   label="blocked" v="11" sub="missing entirely" subCls="err" />
        <SummaryStat color="amber"  label="needs lock" v="5" sub="contract gaps" subCls="warn" />
        <SummaryStat color="blue"   label="delegated" v="3" sub="via agent api" subCls="dim" />
      </div>

      <SectionH label="LOCKED" badgeBg="var(--accent)" title="26 endpoints · ready for parallel build" sub="source · /dashboard-api/internal/handlers/" />
      <Card style={{ padding: 0 }}>
        <Group title="Resources · 4">
          <ContractLine method="GET"    path="/api/v1/resources" status="→ {ok, items: Resource[], total}" />
          <ContractLine method="GET"    path="/api/v1/resources/:id" status="→ {ok, resource} · includes connection_url" />
          <ContractLine method="POST"   path="/api/v1/resources/:id/rotate" status="→ {ok, connection_url, resource}" />
          <ContractLine method="DELETE" path="/api/v1/resources/:id" status="→ {ok}" />
        </Group>
        <Group title="Team & Members · 9">
          <ContractLine method="GET"    path="/api/v1/team" status="→ {ok, team}" />
          <ContractLine method="PATCH"  path="/api/v1/team" status="body: {name?, display_name?}" />
          <ContractLine method="GET"    path="/api/v1/team/members" status="→ {ok, members[], member_limit}" />
          <ContractLine method="POST"   path="/api/v1/team/members/invite" status="body: {email, role}" />
          <ContractLine method="DELETE" path="/api/v1/team/members/:user_id" status="→ {ok}" />
          <ContractLine method="POST"   path="/api/v1/team/members/leave" status="→ {ok, access_token?} · rotates session" />
          <ContractLine method="GET"    path="/api/v1/team/invitations" status="→ {ok, invitations[]}" />
          <ContractLine method="DELETE" path="/api/v1/team/invitations/:id" status="→ {ok}" />
          <ContractLine method="POST"   path="/api/v1/team/invitations/:id/accept" status="→ {ok, access_token?}" />
        </Group>
        <Group title="Billing · 6">
          <ContractLine method="GET"    path="/api/v1/billing" status="→ {ok, plan, billing: BillingDetails}" />
          <ContractLine method="POST"   path="/api/v1/billing/checkout" status="→ {short_url, subscription_id?}" />
          <ContractLine method="POST"   path="/api/v1/billing/cancel" status="→ {ok}" />
          <ContractLine method="GET"    path="/api/v1/billing/invoices" status="→ {ok, invoices[]}" />
          <ContractLine method="POST"   path="/api/v1/billing/update-payment" status="→ {short_url}" />
          <ContractLine method="POST"   path="/api/v1/billing/change-plan" status="→ {new_plan, effective_date, short_url}" />
        </Group>
        <Group title="Stacks · 3">
          <ContractLine method="GET"    path="/api/v1/stacks" status="→ {ok, items: DashboardStack[], total}" />
          <ContractLine method="GET"    path="/api/v1/stacks/:slug" status="→ {ok, stack}" />
          <ContractLine method="DELETE" path="/api/v1/stacks/:slug" status="→ {ok}" />
        </Group>
        <Group title="Auth · 4">
          <ContractLine method="POST"   path="/auth/login" status="body: {email} · auto-creates user · hobby tier" />
          <ContractLine method="POST"   path="/auth/refresh" status="cookie-based · 24h ttl" />
          <ContractLine method="POST"   path="/auth/logout" status="→ {ok}" />
          <ContractLine method="GET"    path="/auth/me" status="→ {ok, user, team, access_token?}" />
        </Group>
      </Card>

      <SectionH label="BLOCKED" badgeBg="var(--rose)" title="11 endpoints · need backend + contract lock" sub="frontend cannot ship until these are defined" />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <BlockedCard
          icon="⚷"
          title="Vault · 5 endpoints"
          intro={<>No handler · no proto · no schema. <strong style={{ color: 'var(--text)' }}>Largest unbuilt subsystem.</strong></>}
          contracts={[
            ['GET',    '/api/v1/vault/:env',                    'propose'],
            ['PUT',    '/api/v1/vault/:env/:key',               'propose'],
            ['POST',   '/api/v1/vault/:env/:key/reveal',        'sudo'],
            ['DELETE', '/api/v1/vault/:env/:key',               'propose'],
            ['GET',    '/api/v1/vault/:env/:key/audit',         'propose']
          ]}
          shape="proposed VaultEntry shape"
          code={<>{`{
  "key":            "STRIPE_SECRET_KEY",
  "env":            "production",
  "team_id":        "550e…20",
  "created_at":     "2026-04-22T…",
  "rotated_at":     "2026-05-01T…",
  "last_read_at":   "2026-05-09T…",
  "read_count":     14,
  "deploys_using":  4
  // value · NEVER returned, only on /reveal
}`}</>}
        />

        <BlockedCard
          icon="📊"
          title="Metrics · 2 endpoints"
          intro="Resource & deployment metrics tabs are designed but the API doesn't exist."
          contracts={[
            ['GET', '/api/v1/resources/:id/metrics?range=24h',   'propose'],
            ['GET', '/api/v1/deployments/:id/metrics?range=24h', 'propose']
          ]}
          shape="proposed shape · series-of-pairs"
          code={<>{`{
  "range": "24h",
  "step_s": 300,
  "series": {
    "storage_mb": [[1715260800,42.1], …],
    "connections": [[1715260800,3], …],
    "qps":          [[1715260800,14.2], …]
  }
}`}</>}
        />

        <BlockedCard
          icon="⊙"
          title="Audit · 4 endpoints"
          intro="Brief mandates audit on resources, deployments, vault & team. Currently zero handlers, zero rows."
          contracts={[
            ['GET', '/api/v1/resources/:id/audit',     'propose'],
            ['GET', '/api/v1/deployments/:id/audit',   'propose'],
            ['GET', '/api/v1/audit?actor=…&action=…',  'cross-team'],
            ['GET', '/api/v1/team/members/:id/audit',  'role changes']
          ]}
          shape="proposed AuditEvent"
          code={<>{`{
  "id":      "evt_8a7c…",
  "at":      "2026-05-10T14:32Z",
  "actor":   "u_aanya",
  "target":  "u_kavya",
  "action":  "member.role_changed",
  "details": {"from":"developer","to":"admin"},
  "ip":      "104.28.7.91"
}`}</>}
        />

        <BlockedCard
          icon="⟳"
          title="Deploy actions & logs · 4 endpoints"
          intro="Redeploy/rollback/stop and logs SSE all go directly to agent api today. Should proxy via dashboard-api for auth + audit."
          contracts={[
            ['POST', '/api/v1/stacks/:slug/redeploy', 'proxy → agent'],
            ['POST', '/api/v1/stacks/:slug/rollback', 'propose'],
            ['POST', '/api/v1/stacks/:slug/stop',     'propose'],
            ['GET',  '/api/v1/stacks/:slug/logs',     'SSE · propose']
          ]}
          shape="SSE event · text/event-stream"
          code={<>{`data: {"ts":"…", "phase":"building",
       "level":"info",
       "message":"npm ci · 18.4s"}

event: status
data: {"status":"healthy",
       "url":"https://…",
       "build_duration_s": 38}

event: end
data: {}`}</>}
        />
      </div>

      <SectionH label="NEEDS LOCK" badgeBg="var(--amber)" title="5 contradictions or partial implementations" sub="FE/BE will diverge until these resolve" />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ContractBanner kind="warning" badge="#1">
          <strong>Trial vs. immediate Hobby.</strong> <code>plans.yaml</code> declares <code>trial_days: 14</code>; <code>auth.go:151</code> assigns <code>hobby</code> with no trial fields. Brief journey 1 assumes a trial. <strong>Lock:</strong> add <code>teams.trial_ends_at</code> + worker, OR drop trial language from copy.
        </ContractBanner>
        <ContractBanner kind="warning" badge="#2">
          <strong>"Deployments" vs "Stacks".</strong> Brief uses "Deployments"; proto + dashboard-api use "Stacks". <strong>Lock:</strong> dashboard URL is <code>/deployments</code> (user language), API stays <code>/stacks</code> (existing).
        </ContractBanner>
        <ContractBanner kind="warning" badge="#3">
          <strong>Multi-env scoping.</strong> Resource shape includes <code>env</code> but list endpoint has no <code>?env=</code> filter. <strong>Lock:</strong> add server-side filter param + <code>teams.default_env</code> in PATCH body.
        </ContractBanner>
        <ContractBanner kind="warning" badge="#4">
          <strong>Role changes.</strong> Members are invited with a role; there's no <code>PATCH /members/:id</code> for promotion/demotion. <strong>Lock:</strong> add <code>PATCH /api/v1/team/members/:user_id</code> with body <code>{`{role}`}</code> + audit row.
        </ContractBanner>
        <ContractBanner kind="warning" badge="#5">
          <strong>Multi-service stacks.</strong> Brief separates <em>Deployments</em> (single service) from <em>Stacks</em> (multi-service compose). <code>DashboardStack</code> has no <code>services[]</code> field.
        </ContractBanner>
      </div>

      <SectionH label="DELEGATED" badgeBg="var(--blue)" title="3 surfaces · routes to agent api" sub="not in dashboard-api · already documented in /flows" />
      <Card style={{ padding: '18px 20px' }}>
        <ContractLine method="POST" path="api.instanode.dev/db/new · /cache/new · /mongo/new · /queue/new · /storage/new · /webhook/new · /deploy/new" status="→ agent api" />
        <ContractLine method="POST" path="api.instanode.dev/claim · /start?t=jwt · /claim/preview" status="→ agent api" />
        <ContractLine method="GET"  path="api.instanode.dev/healthz" status="→ agent api" />
        <p style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.5, marginTop: 14 }}>
          Anonymous calls, claim, healthz live on <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text)', background: 'var(--ink)', padding: '1px 5px', borderRadius: 3, border: '1px solid var(--border)' }}>api.instanode.dev</code>. Dashboard never proxies these.
        </p>
      </Card>

      <div
        style={{
          marginTop: 40,
          padding: 24,
          background: 'linear-gradient(180deg, rgba(0,228,142,0.04), transparent)',
          border: '1px solid rgba(0,228,142,0.15)',
          borderRadius: 14
        }}
      >
        <h3 style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.02em', marginBottom: 6 }}>
          Recommended unblock order
        </h3>
        <p style={{ fontSize: 13.5, color: 'var(--text-dim)', marginBottom: 18 }}>
          If we lock these in sequence, FE and BE can ship without merge-day surprises.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Week n={1} title="Lock the contradictions" body="Trial decision · /deployments mapping · multi-env filter param." />
          <Week n={2} title="Vault contract" body="5 endpoints · schema · sudo flow. Largest single chunk." />
          <Week n={3} title="Logs SSE + actions" body="Redeploy / rollback / stop · SSE event format. Build view depends." />
          <Week n={4} title="Metrics + audit" body="Last to lock — design works without them on day one." />
        </div>
      </div>
    </>
  )
}

function SummaryStat({ color, label, v, sub, subCls = '' }: { color: string; label: string; v: string; sub: string; subCls?: string }) {
  const cssColor =
    color === 'accent' ? 'var(--accent)' :
    color === 'rose'   ? 'var(--rose)'   :
    color === 'amber'  ? 'var(--amber)'  : 'var(--blue)'
  return (
    <div className="stat" style={{ borderColor: `color-mix(in srgb, ${cssColor} 25%, var(--border))` }}>
      <div className="k" style={{ color: cssColor }}>{label}</div>
      <div className="v" style={{ color: cssColor }}>{v}</div>
      <div className={`d ${subCls}`}>{sub}</div>
    </div>
  )
}

function SectionH({ label, badgeBg, title, sub }: { label: string; badgeBg: string; title: string; sub: string }) {
  return (
    <div className="section-h" style={{ marginTop: 40 }}>
      <h2 style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, padding: '3px 7px', background: badgeBg, color: 'var(--ink)', borderRadius: 3, letterSpacing: '0.06em', fontWeight: 600 }}>
          {label}
        </span>
        {title}
      </h2>
      <span className="sub">{sub}</span>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <div
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--border)',
          borderTop: '1px solid var(--border)',
          background: 'var(--surface)'
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10.5,
            color: 'var(--text-faint)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em'
          }}
        >
          {title}
        </div>
      </div>
      <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 0 }}>
        {children}
      </div>
    </>
  )
}

function BlockedCard({
  icon, title, intro, contracts, shape, code
}: {
  icon: string
  title: string
  intro: React.ReactNode
  contracts: [string, string, string][]
  shape: string
  code: React.ReactNode
}) {
  return (
    <div className="card" style={{ borderColor: 'rgba(255,122,138,0.18)' }}>
      <div className="card-h" style={{ display: 'flex', gap: 8 }}>
        <span style={{
          width: 18, height: 18, background: 'rgba(255,122,138,0.1)',
          borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--rose)', fontSize: 10, border: '1px solid rgba(255,122,138,0.2)'
        }}>{icon}</span>
        {title}
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 12 }}>{intro}</p>
      {contracts.map(([m, p, s]) => (
        <ContractLine key={p} method={m as any} path={p} status={s} />
      ))}
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--border)' }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)',
          textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8
        }}>
          {shape}
        </div>
        <pre className="codeblock" style={{ margin: 0 }}>{code}</pre>
      </div>
    </div>
  )
}

function Week({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div style={{ padding: '14px 16px', background: 'var(--ink)', border: '1px solid var(--border)', borderRadius: 8 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)', marginBottom: 6, letterSpacing: '0.06em' }}>
        WEEK {n}
      </div>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>{body}</div>
    </div>
  )
}
