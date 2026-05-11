import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ContractBanner, RolePill, RelTime, PromptPill, PromptCard, Card } from '../components/Common'
import * as api from '../api'
import type { TeamMember, TeamInvitation } from '../api'
import { useDashboardCtx } from '../hooks/useDashboardCtx'

export function TeamPage() {
  const ctx = useDashboardCtx()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [invites, setInvites] = useState<TeamInvitation[]>([])

  useEffect(() => {
    Promise.all([api.listMembers(), api.listInvitations()]).then(([m, i]) => {
      setMembers(m.members)
      setInvites(i.invitations)
    })
  }, [])

  // Build a personalized example invite from the current user's email domain
  // (e.g., aanya@acme.dev → exampleEmail = "kavya@acme.dev"). When the
  // domain isn't known we fall back to a generic example.
  const userDomain = ctx.me?.user?.email?.split('@')[1] ?? 'example.com'
  const exampleEmail = `kavya@${userDomain}`

  return (
    <>
      <ContractBanner kind="locked" badge="locked">
        <strong>7 endpoints live.</strong> <code>GET /api/v1/team/members</code> · <code>POST .../invite</code> ·{' '}
        <code>DELETE .../:user_id</code> · <code>POST .../leave</code> · <code>GET /invitations</code> ·{' '}
        <code>DELETE /invitations/:id</code> · <code>POST /invitations/:id/accept</code>.
      </ContractBanner>

      <ContractBanner kind="warning" badge="role gap">
        <strong><code>PATCH /api/v1/team/members/:user_id</code> for role changes is missing.</strong> Brief §5.8 requires Owner / Admin / Developer / Viewer with promotion/demotion.
      </ContractBanner>

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16 }}>
        <div>
          <div className="section-h">
            <h2>Members · {members.length}</h2>
            <PromptPill label="invite teammate" />
          </div>

          <PromptCard
            title="Invite via agent"
            hint="most-used team prompt"
            prompt={<>Invite <em>{exampleEmail}</em> as a developer with the welcome note "staging cluster is ready"</>}
            method="POST"
            endpoint="/api/v1/team/members/invite"
          />

          <div className="card" style={{ padding: 0, marginTop: 16 }}>
            {members.map((m) => (
              <div key={m.id} className="team-row">
                <div
                  className="av"
                  style={{
                    background: m._avatar_color
                      ? `linear-gradient(135deg, ${m._avatar_color}, ${shade(m._avatar_color, -50)})`
                      : 'linear-gradient(135deg, var(--violet), #6c45ce)'
                  }}
                >
                  {(m.display_name ?? m.email)[0].toUpperCase()}
                </div>
                <div>
                  <div className="name">{m.display_name ?? m.email.split('@')[0]}</div>
                  <div className="email">{m.email}</div>
                </div>
                <RolePill role={m.role} />
                <button className="res-action">⋯</button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="section-h">
            <h2>Pending · {invites.length}</h2>
            <span className="sub">expire in 7d</span>
          </div>

          <div className="card" style={{ padding: 0 }}>
            {invites.map((i) => (
              <div key={i.id} className="team-row" style={{ gridTemplateColumns: '1fr auto auto', gap: 12 }}>
                <div>
                  <div className="email" style={{ fontSize: 12.5, color: 'var(--text)' }}>{i.email}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-faint)', marginTop: 2 }}>
                    invited <RelTime at={i.created_at} /> by {i.invited_by_name}
                  </div>
                </div>
                <RolePill role={i.role} />
                <button className="btn btn-sm btn-ghost">revoke</button>
              </div>
            ))}
          </div>

          <Card title="Plan limit" style={{ marginTop: 16 }}>
            <p style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55, marginBottom: 12 }}>
              Pro tier · 5 team seats. Higher seat limits ship with the Team tier (coming soon).
            </p>
            <Link to="/billing" className="btn btn-secondary btn-sm" style={{ display: 'inline-flex' }}>
              View billing →
            </Link>
          </Card>
        </div>
      </div>
    </>
  )
}

// minimal hex shading helper
function shade(hex: string, amt: number): string {
  const m = hex.replace('#', '')
  if (m.length !== 6) return hex
  const r = clamp(parseInt(m.slice(0, 2), 16) + amt)
  const g = clamp(parseInt(m.slice(2, 4), 16) + amt)
  const b = clamp(parseInt(m.slice(4, 6), 16) + amt)
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`
}
const clamp = (n: number) => Math.max(0, Math.min(255, n))
