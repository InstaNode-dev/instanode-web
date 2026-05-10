import { ContractBanner, EnvPill, StatusPill, ResourceIcon, RelTime } from '../components/Common'

export function StacksPage() {
  return (
    <>
      <ContractBanner kind="warning" badge="design split">
        <strong>The brief separates "Deployments" (single service) from "Stacks" (multi-service).</strong> The backend's{' '}
        <code>DashboardStack</code> handles both — there's no "service" concept in the proto yet.
      </ContractBanner>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center' }}>
            <h3 style={{ fontSize: 15, fontWeight: 500 }}>acme-platform</h3>
            <StatusPill status="running" />
            <span style={{ marginLeft: 'auto' }}><EnvPill env="production" /></span>
          </div>
          <div>
            <div style={{
              display: 'grid', gridTemplateColumns: '1.4fr 1fr 70px', gap: 10,
              padding: '8px 16px', background: 'var(--surface)',
              fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)',
              textTransform: 'uppercase', letterSpacing: '0.05em'
            }}>
              <span>service</span><span>image</span><span>status</span>
            </div>
            {['api-gateway', 'worker', 'scheduler'].map((svc) => (
              <div key={svc}
                style={{
                  display: 'grid', gridTemplateColumns: '1.4fr 1fr 70px', gap: 10,
                  padding: '9px 16px', borderTop: '1px solid var(--border)',
                  alignItems: 'center', fontSize: 12.5
                }}>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <ResourceIcon type="deploy" size={16} /> {svc}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>v1.4.0</span>
                <StatusPill status="running" />
              </div>
            ))}
          </div>
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>
              last deploy <RelTime at={new Date(Date.now() - 7200_000).toISOString()} /> · build 52s
            </span>
          </div>
        </div>

        <div className="empty">
          <div className="ill">+</div>
          <h3>One stack, many services</h3>
          <p>
            Stacks group services that share an env, vault, and lifecycle. Deploy them as a unit with one <code>compose.yml</code>.
          </p>
          <span className="curl">ask your agent · "create a new stack"</span>
        </div>
      </div>
    </>
  )
}
