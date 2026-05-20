import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ContractBanner, RolePill, RelTime, PromptCard, Card } from '../components/Common'
import * as api from '../api'
import type { TeamMember, TeamInvitation } from '../api'
import { useDashboardCtx } from '../hooks/useDashboardCtx'
import { isRateLimited, retryAfterSeconds, formatRetryHint } from '../lib/retryHint'

// LoadError — what the team-list fetch failed with. `rateLimited` lets the
// banner show the user-facing "retry in Ns" hint for an HTTP 429 instead
// of a bare error string (BugBash: the 429 data layer landed earlier; this
// is the user-facing half).
type LoadError = { message: string; rateLimited: boolean; retrySeconds: number | null }

export function TeamPage() {
  const ctx = useDashboardCtx()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [invites, setInvites] = useState<TeamInvitation[]>([])
  // B8-P2 F22/F23 (2026-05-20): server-driven member_limit. Was previously
  // a hardcoded tier→string map that silently went stale when plans.yaml
  // bumped pro/growth/team_members. The api returns the live integer
  // alongside /team/members; we render it directly so the dashboard can't
  // drift from the source of truth.
  const [memberLimit, setMemberLimit] = useState<number | null>(null)
  const [err, setErr] = useState<LoadError | null>(null)

  useEffect(() => {
    // BugBash P3: the Promise.all had no .catch() and no cancellation
    // guard. If either /team/members or /team/invitations rejected (429,
    // 5xx, network), the rejection went unhandled and the page sat
    // silently empty with zero feedback. Mirror the load pattern used by
    // ResourcesPage / DeploymentsPage: catch → surface an error string,
    // and an `alive` flag so a fast unmount can't setState on a dead
    // component.
    let alive = true
    setErr(null)
    Promise.all([api.listMembers(), api.listInvitations()])
      .then(([m, i]) => {
        if (!alive) return
        setMembers(m.members)
        setInvites(i.invitations)
        setMemberLimit(m.member_limit)
      })
      .catch((e) => {
        if (!alive) return
        setErr({
          message: e?.message ?? 'Could not load team members',
          rateLimited: isRateLimited(e),
          retrySeconds: retryAfterSeconds(e),
        })
      })
    return () => { alive = false }
  }, [])

  // Build a personalized example invite from the current user's email domain
  // (e.g., aanya@acme.dev → exampleEmail = "kavya@acme.dev"). When the
  // domain isn't known we fall back to a generic example.
  const userDomain = ctx.me?.user?.email?.split('@')[1] ?? 'example.com'
  const exampleEmail = `kavya@${userDomain}`

  // Tier-aware seat limit text — driven by the server's `member_limit` so
  // adding a tier or bumping a cap in plans.yaml propagates automatically.
  // -1 means unlimited; null means the call hasn't resolved yet (we render
  // a non-specific fallback so the prompt doesn't claim a wrong number).
  const tier = ctx.me?.team?.tier
  const tierLabel = tier ? `${tier} tier` : 'Your tier'
  const seatLabel =
    memberLimit == null
      ? 'seat limits per plan'
      : memberLimit < 0
        ? 'unlimited team seats'
        : memberLimit === 1
          ? '1 team seat'
          : `${memberLimit} team seats`

  return (
    <>
      {err && (
        <div
          role="alert"
          className="card"
          style={{
            padding: '10px 14px',
            marginBottom: 16,
            borderColor: err.rateLimited ? 'var(--amber)' : 'var(--rose)',
            color: err.rateLimited ? 'var(--amber)' : 'var(--rose)',
            fontSize: 12.5,
          }}
        >
          {err.rateLimited ? (
            <>
              Too many requests — the team list is rate-limited.{' '}
              {formatRetryHint(err.retrySeconds)}
            </>
          ) : (
            <>Could not load team members — {err.message}. Reload the page to try again.</>
          )}
        </div>
      )}

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
