import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ContractBanner, RolePill, RelTime, PromptCard, Card } from '../components/Common'
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

  // Tier-aware seat limit text. Values mirror api/plans.yaml team_members.
  // The dashboard never writes — this is just human-facing copy.
  const tier = ctx.me?.team?.tier
  const seatLimitByTier: Record<string, string> = {
    anonymous: '1 team seat',
    free: '1 team seat',
    hobby: '1 team seat',
    pro: '5 team seats',
    team: 'unlimited team seats',
    growth: '10 team seats',
  }
  const tierLabel = tier ? `${tier} tier` : 'Your tier'
  const seatLabel = tier ? seatLimitByTier[tier] ?? 'seat limits per plan' : 'seat limits per plan'

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
          </div>

          <PromptCard
            title="Invite a teammate"
            hint="most-used team prompt"
            prompt={
              <>
                Invite <em>{exampleEmail}</em> to my instanode team as a <strong>developer</strong> with
                the welcome note <em>"staging cluster is ready"</em>. Use the team API endpoint and
                my INSTANODE_TOKEN for auth.
              </>
            }
            promptText={
              `Invite ${exampleEmail} to my instanode team as a developer with the welcome note "staging cluster is ready".\n` +
              `\n` +
              `- Team has ${members.length} members today (limit is plan-dependent — ${tierLabel} · ${seatLabel}).\n` +
              `- Endpoint: POST https://api.instanode.dev/api/v1/team/members/invite\n` +
              `- Body: {"email":"${exampleEmail}","role":"developer","welcome_note":"staging cluster is ready"}\n` +
              `- Auth: use my INSTANODE_TOKEN env var as Bearer\n` +
              `\n` +
              `The invitee receives an email with a 7-day claim link. If the role is wrong, run the same endpoint again — the latest invite supersedes earlier ones.`
            }
            method="POST"
            endpoint="/api/v1/team/members/invite"
          />

          <PromptCard
            title="Revoke a pending invitation"
            hint="via agent"
            prompt={
              <>
                Revoke a pending team invitation by id. The invitee's claim link stops working
                immediately. Re-invite anytime with the invite prompt above.
              </>
            }
            promptText={
              `Revoke a pending instanode team invitation.\n` +
              `\n` +
              `- Invitation id: <INVITATION_ID — see Pending list in the dashboard>\n` +
              `- Endpoint: DELETE https://api.instanode.dev/api/v1/team/invitations/<INVITATION_ID>\n` +
              `- Auth: use my INSTANODE_TOKEN env var as Bearer\n` +
              `\n` +
              `Team has ${invites.length} pending invitation(s) today. The 7-day claim link is invalidated; the invitee can be re-invited at any time.`
            }
            method="DELETE"
            endpoint="/api/v1/team/invitations/{id}"
          />

          <PromptCard
            danger
            title="Remove a teammate"
            hint="data loss"
            prompt={
              <>
                Remove a teammate by user id. They lose access to every resource scoped to this
                team. Their personal API tokens are revoked at the same moment.
              </>
            }
            promptText={
              `Remove a teammate from my instanode team.\n` +
              `\n` +
              `- User id: <USER_ID — see Members list in the dashboard>\n` +
              `- Endpoint: DELETE https://api.instanode.dev/api/v1/team/members/<USER_ID>\n` +
              `- Auth: use my INSTANODE_TOKEN env var as Bearer\n` +
              `\n` +
              `Team has ${members.length} member(s) today (${tierLabel} · ${seatLabel}). The removed user's INSTANODE_TOKENs stop working immediately. To re-add later, send a fresh invitation.`
            }
            method="DELETE"
            endpoint="/api/v1/team/members/{user_id}"
          />

          <div className="card" style={{ padding: 0, marginTop: 16 }}>
            {members.map((m) => (
              <div key={m.id} className="team-row" style={{ gridTemplateColumns: '36px 1fr 1fr' }}>
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
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-faint)' }}>
                  via agent ↓
                </span>
              </div>
            ))}
          </div>

          <Card title="Plan limit" style={{ marginTop: 16 }}>
            <p style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55, marginBottom: 12 }}>
              {tierLabel} · {seatLabel}. Higher seat limits ship with the Team tier.
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
