/* ChangelogPage — public, unauthenticated /changelog.
 *
 * The contractual change-notice channel referenced by the DPA, the
 * subprocessor list, and trust-residency.md ("we notify customers at
 * least 30 days before adding or replacing a sub-processor; subscribe to
 * the changelog"). Before this page existed the link 404'd and every doc
 * that promised customers a change-feed was technically lying.
 *
 * Reverse-chronological. Each entry: date heading + 3-5 concise bullets.
 * Entries are inlined here as a TypeScript array (vs. a content repo /
 * markdown loader) because (a) the cadence is low — call it weekly at
 * most — and (b) keeping the source in-tree means a single PR ships the
 * fix and the entry that documents the fix.
 *
 * Wrapped in PublicShell so the top nav + footer match the rest of the
 * marketing surfaces. Mirrors the IncidentsPage layout vocabulary
 * (public-eyebrow / public-h1 / public-sub / public-section) so a
 * visitor moving between /status, /incidents, /changelog feels the
 * pages are the same surface. */

import { useEffect } from 'react'
import { PublicShell } from '../layout/PublicShell'

// ─── types ────────────────────────────────────────────────────────────────

interface ChangelogEntry {
  /** ISO date (YYYY-MM-DD). Sort key — newest first. */
  date: string
  /** Short headline summarising the day's changes. */
  title: string
  /** 3-5 concise bullets describing what shipped. */
  bullets: string[]
}

// ─── content ──────────────────────────────────────────────────────────────

/* Reverse-chronological. Add new entries at the TOP of the array. Keep
 * each bullet single-line, no marketing fluff — the audience is a
 * procurement reviewer or an on-call engineer checking what changed. */
const ENTRIES: ChangelogEntry[] = [
  {
    date: '2026-05-18',
    title: 'Marketing + dashboard hardening pass',
    bullets: [
      'Pricing comparison grid corrected to four tier columns — a stale six-track layout left a dead empty column.',
      'Marketing pages now have a mobile navigation menu below 880px (previously all nav links vanished on phones).',
      'Every public page now ships its own <title>, meta description, and canonical URL — subpages no longer self-canonicalize to the homepage.',
      'sitemap.xml is generated at build time and now covers every page including blog posts and use-case detail pages.',
      'Billing checkout is no longer suppressed for freshly-claimed paid teams; tier-wall messages now carry the agent action and upgrade link.',
    ],
  },
  {
    date: '2026-05-17',
    title: 'Bug-hunt remediation — P0/P1 fixes',
    bullets: [
      'Hardened POST /claim against account-takeover: a claim now requires the session it claims into and no longer mints a token for a pre-existing email.',
      'Large deploy tarballs are read in full (io.ReadAll) — fixed a truncation bug where big multipart uploads built on a partly-zero buffer.',
      'Redeploys now re-resolve vault:// env references, so vault-backed apps no longer break on redeploy.',
      'Customer-deploy NetworkPolicy egress now covers the production DOKS pod/service CIDRs (was hardcoded to the dev cluster ranges).',
      'Continuous deployment: a push to the api, worker, or provisioner default branch now builds, pushes, and rolls out to production automatically, with an in-cluster build-SHA verification gate.',
    ],
  },
  {
    date: '2026-05-16',
    title: 'Tier enforcement + billing resilience',
    bullets: [
      'Provisioning responses now redact secret-bearing env values (credential URLs, *_KEY/_SECRET/_TOKEN keys); the dashboard masks them behind a reveal toggle.',
      'Storage-quota enforcement now does a real provisioner-side revoke (Postgres REVOKE CONNECT, Redis ACL disable, Mongo role revoke) with auto-unsuspend when usage drops.',
      'Plan upgrades now elevate deployments and stacks alongside resources and clear their anonymous 24h TTL — a paid app is no longer expired by the lifecycle worker.',
      'Billing reconciler added: a 15-minute poll against Razorpay closes any missed-webhook gap in either direction.',
      'Dedicated Redis is capped at provision time with a per-tier maxmemory; the entitlement reconciler re-applies the cap on tier changes.',
    ],
  },
  {
    date: '2026-05-15',
    title: 'Pro storage bump + annual pricing',
    bullets: [
      'Pro-tier storage raised to 10 GB Postgres / 512 MB Redis / 5 GB MongoDB — a material limits increase across all Pro subscriptions.',
      'Annual billing added for Hobby, Hobby Plus, Pro, and Team: same limits as the monthly plans, billed yearly at a discount.',
      'Free, Hobby Plus, and Growth tiers reconciled across the pricing page, billing page, and API documentation so every surface quotes the same numbers.',
      'Default provisioning environment is now "development" — a call that omits `env` lands in the lowest-stakes bucket instead of merging with production state.',
    ],
  },
  {
    date: '2026-05-14',
    title: 'Trust + marketing accuracy pass (W12)',
    bullets: [
      'DPA + trust-residency aligned on Standard Contractual Clauses (Module Two, controller-to-processor) as the EU/UK transfer mechanism.',
      'Subprocessor list expanded with Resend (transactional email), Cloudflare (CDN/DNS), Fastly + GitHub Pages (marketing/docs serving), and Loops (lifecycle email forwarder).',
      'Homepage step-02 encryption-at-rest claim narrowed to "vault secrets and stored credentials" — the customer Postgres cluster\'s disk is not blanket-encrypted on the anonymous tier.',
      '/changelog is now a real route (was 404; referenced by DPA §6, subprocessor list, and trust-residency egress section).',
      'llms.txt and llms-full.txt clarified to call out DigitalOcean Spaces (S3-compatible) as the production object-store backend.',
    ],
  },
  {
    date: '2026-05-13',
    title: 'Hobby Plus tier + W11 dashboard honesty pass',
    bullets: [
      'Hobby Plus tier ($19/mo) shipped as the middle step in the pricing grid — research-backed triple-tier pricing decoy.',
      'Agent error envelope standardised across all provisioning endpoints with `agent_action` next-step hints.',
      'security.md + PGP key + DPA + subprocessor list published at /docs/public/* (was 404 from W10 onward).',
      'Per-tenant MinIO IAM credentials by default in production — anonymous-tier internal_url scrubbed from response payloads.',
      'GitHub auto-deploy webhook live; /status page now consumes real GET /api/v1/status backend.',
    ],
  },
  {
    date: '2026-05-12',
    title: 'DO Spaces production cutover + deploy wedge live',
    bullets: [
      'Object-storage production backend cut over from in-cluster MinIO to DigitalOcean Spaces (`nyc3`); 24h lifecycle rule enforces anonymous-tier auto-expiry at the storage layer.',
      'POST /deploy/new live end-to-end (Kaniko → k8s Deployment → Ingress + cert-manager TLS on *.deployment.instanode.dev).',
      'Idempotency-Key replay header honoured on every provisioning endpoint; provisioner-auth regression test bundle added to CI.',
      'dashboard-api retired — agent API now serves the dashboard directly. Removes the gRPC bridge that was the source of a long tail of cross-service auth drift.',
    ],
  },
]

// ─── page ─────────────────────────────────────────────────────────────────

export function ChangelogPage() {
  const sorted = [...ENTRIES].sort((a, b) => b.date.localeCompare(a.date))

  // B3-P1-8 (BugBash 2026-05-20): static prerender writes the right
  // <title> ("Changelog · instanode") into dist/changelog/index.html, but
  // SPA navigation from /pricing → /changelog never re-applies it — the
  // tab title stays as whatever was last set, typically the homepage
  // default. Mirror the prerender meta into the live document on mount
  // and restore the previous title on unmount so the next SPA hop
  // doesn't inherit changelog meta.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const prevTitle = document.title
    document.title = 'Changelog · instanode'
    return () => {
      document.title = prevTitle
    }
  }, [])

  return (
    <PublicShell>
      <ChangelogStyles />

      <section className="changelog-header">
        <span className="public-eyebrow">Changelog · public · reverse-chronological</span>
        <h1 className="public-h1">
          Changelog<span className="dot">.</span>
        </h1>
        <p className="public-sub">
          What changed on instanode. Subprocessor adds, sub-processor swaps, and material
          posture changes are announced here at least 30 days in advance — see the{' '}
          <a href="/docs/public/dpa.md">DPA</a> and the{' '}
          <a href="/docs/public/subprocessors.md">subprocessor list</a> for the formal
          commitment.
        </p>
      </section>

      <section className="public-section">
        <ol className="changelog-list" aria-label="Changelog entries">
          {sorted.map((entry) => (
            <li key={entry.date} className="changelog-entry">
              <header className="changelog-entry-head">
                <time dateTime={entry.date} className="changelog-entry-date">
                  {formatDate(entry.date)}
                </time>
                <h2 className="changelog-entry-title">{entry.title}</h2>
              </header>
              <ul className="changelog-entry-bullets">
                {entry.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>

      <section className="public-section changelog-links">
        <a href="/docs/public/subprocessors.md" className="changelog-link">
          Subprocessors
        </a>
        <span className="changelog-link-sep">·</span>
        <a href="/docs/public/trust-residency.md" className="changelog-link">
          Trust + residency
        </a>
        <span className="changelog-link-sep">·</span>
        {/* B3-P1-7 (BugBash 2026-05-20): "Subscribe" used to be a single
            mailto link only — no feed for procurement reviewers /
            on-call engineers who want a programmatic update channel.
            Add the Atom feed alongside the mailto so both paths work.
            Feed is emitted by scripts/prerender.mjs writeChangelogAtomFeed. */}
        <a href="/changelog/rss.xml" className="changelog-link">
          Subscribe (Atom feed)
        </a>
        <span className="changelog-link-sep">·</span>
        <a
          href="mailto:privacy@instanode.dev?subject=Subscribe%20to%20changelog%20notices"
          className="changelog-link"
        >
          Subscribe (email)
        </a>
      </section>
    </PublicShell>
  )
}

// ─── helpers ──────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  // Parse manually so we render the same date regardless of viewer
  // timezone — a 2026-05-14 entry should never appear as "May 13" to a
  // visitor in the Pacific timezone.
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

// ─── styles ───────────────────────────────────────────────────────────────

function ChangelogStyles() {
  return (
    <style>{`
      .changelog-header { padding-top: 8px; }

      .changelog-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 28px;
      }
      .changelog-entry {
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--surface);
        padding: 24px 24px 20px;
      }
      .changelog-entry-head {
        display: flex;
        align-items: baseline;
        gap: 14px;
        margin-bottom: 14px;
        flex-wrap: wrap;
      }
      .changelog-entry-date {
        color: var(--text-faint);
        font-family: var(--font-mono);
        font-size: 12.5px;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .changelog-entry-title {
        margin: 0;
        font-size: 18px;
        font-weight: 500;
        color: var(--text);
        letter-spacing: -0.005em;
      }
      .changelog-entry-bullets {
        margin: 0;
        padding-left: 18px;
        color: var(--text-dim);
        font-size: 14px;
        line-height: 1.6;
      }
      .changelog-entry-bullets li { margin-bottom: 6px; }
      .changelog-entry-bullets li:last-child { margin-bottom: 0; }

      .changelog-links {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 13px;
        flex-wrap: wrap;
      }
      .changelog-link { color: var(--text-dim); transition: color 120ms; }
      .changelog-link:hover { color: var(--accent); }
      .changelog-link-sep { color: var(--text-faint); }
    `}</style>
  )
}
