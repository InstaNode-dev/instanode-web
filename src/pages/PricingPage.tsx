/* PricingPage — public marketing page at /pricing.
   All numbers/prices come from the spec; nothing invented.
   Wrapped in PublicShell for the glassmorphic top nav + footer. */

import { useEffect, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { PublicShell } from '../layout/PublicShell'
import { copyToClipboard } from '../components/Common'

// TierKey — the local-to-this-page tier enum. Marketing /pricing uses
// `anonymous` (the public-facing label for the no-signup free curl tier),
// not `free` — the marketing CTA goes through the agent flow rather than
// the dashboard signup.
//
// 2026-05-15: `hobby_plus` removed from this enum to keep the marketing
// surface as Anonymous / Hobby / Pro / Team. Hobby Plus is still a real
// paid tier in api/plans.yaml — it's reached via dashboard upsell flows
// (quota_wall, custom_domain prompts), not the public pricing ladder.
//
// 2026-06-05 (task #56): `enterprise` added as a NON-self-serve "contact us"
// wall to the RIGHT of Team. It is NOT a tier in api/plans.yaml — no plan
// row, no price, no checkout path. It is a GTM surface only: for anyone who
// breaches Team's finite caps or needs dedicated/isolated infra, multi-region,
// or compliance (SOC2/BAA/SSO/SLA/DPA). Every Enterprise cell renders
// "Custom" / "Contact us", never a number and never the retired word
// "unlimited".
type TierKey = 'anonymous' | 'hobby' | 'pro' | 'team' | 'enterprise'

// P2: monthly vs yearly pricing. The toggle on this page is purely
// presentational — the CTA passes the chosen cycle through as
// `?frequency=yearly` so the in-product checkout flow can read it.
// Numbers come from api/plans.yaml; the effective monthly is the annual
// total divided by 12, rounded to two decimals for display.
type PricingFrequency = 'monthly' | 'yearly'

const FREQ_STORAGE_KEY = 'instant.billing.plan_frequency'

// SOURCE-OF-TRUTH-RISK: this matrix (TIERS + ROWS below) mirrors
// api/plans.yaml. When updating tier prices, limits, or names, update
// api/plans.yaml in the SAME PR — the two are not wired together yet
// (M11 marketing-matrix migration is post-W12 scope). A regression test
// in PricingPage.test.tsx asserts the five tier cards are present so an
// accidental deletion can't slip through CI.
const TIERS: {
  key: TierKey
  name: string
  // price + sub render the headline figure for the selected frequency.
  monthly: { price: string; sub: string }
  yearly?: { price: string; sub: string; saveLabel: string }
  cta: string
  ctaHrefMonthly: string
  ctaHrefYearly?: string
  highlighted?: boolean
  comingSoon?: boolean
}[] = [
  {
    key: 'anonymous',
    name: 'Anonymous',
    monthly: { price: 'free', sub: '24h ttl' },
    // DOG-48 (2026-05-29): previous CTA "Try the curl" implied an in-page
    // interactive runner — but the #try-curl section is a static <code>
    // block with a copy-to-clipboard button, not a real REPL. Renamed to
    // "See the curl" so the language matches the surface. Building a real
    // playground (DOG-47) is a separate scoped piece of work.
    cta: 'See the curl',
    ctaHrefMonthly: '#try-curl',
  },
  {
    key: 'hobby',
    name: 'Hobby',
    monthly: { price: '$9', sub: '/ mo' },
    // FIX-K (2026-05-16): plans.yaml hobby_yearly=9000c=$90/yr=$7.50/mo. Was $8.25/save $9/yr.
    yearly: { price: '$7.50', sub: '/ mo billed yearly', saveLabel: 'save $18/yr' },
    cta: 'Start hobby →',
    // W12 C1: CTAs go to /app/checkout (under AuthGate) instead of the
    // unregistered /checkout path. The auth bounce sends anon visitors
    // through /login with state.from preserved so they land back here.
    ctaHrefMonthly: '/app/checkout?plan=hobby&frequency=monthly',
    ctaHrefYearly: '/app/checkout?plan=hobby&frequency=yearly',
  },
  // 2026-05-15: Hobby Plus tile removed from the marketing matrix.
  // The tier still exists in plans.yaml and is offered via dashboard
  // upsell flows (quota wall, custom-domain prompts) — it's an
  // internal step, not a public funnel entry. Re-insert here if the
  // tier ever becomes a primary acquisition surface.
  {
    key: 'pro',
    name: 'Pro',
    monthly: { price: '$49', sub: '/ mo' },
    yearly: { price: '$40.83', sub: '/ mo billed yearly', saveLabel: 'save $98/yr' },
    cta: 'Start pro →',
    ctaHrefMonthly: '/app/checkout?plan=pro&frequency=monthly',
    ctaHrefYearly: '/app/checkout?plan=pro&frequency=yearly',
    highlighted: true,
  },
  // Team tier — $199/mo, high finite limits across the board (NOT unlimited
  // as of the 2026-06-05 strict-margin redesign); the upsell vs Pro is
  // dedicated infra + 90-day backup retention + SLA + RBAC + SAML + far
  // higher caps. Anyone needing more than the finite Team caps is routed to
  // Enterprise (contact sales). Per api/plans.yaml ($199/mo, $1990/yr).
  {
    key: 'team',
    name: 'Team',
    monthly: { price: '$199', sub: '/ mo' },
    // team_yearly: $1990/yr ≈ $165.83/mo (~17% off $199 x 12).
    yearly: { price: '$165.83', sub: '/ mo billed yearly', saveLabel: 'save $398/yr' },
    cta: 'Contact sales →',
    // TEAM-GATE (2026-06-04 CEO directive): Team is NOT self-serve and must
    // not route to /app/checkout until its unlimited-resource delivery is
    // proven built. This DELIBERATELY REVERSES DOG-10 (2026-05-29), which
    // had flipped Team's CTA from a contact-sales mailto to a self-serve
    // /app/checkout?plan=team link. DOG-10's "Self-serve at every tier"
    // rationale is overridden: Team is sales-assisted only for now. Do NOT
    // re-point this at /app/checkout. Ref:
    // docs/sessions/2026-06-04/TEAM-PLAN-GATE-AND-BUILD.md.
    // mailto on both cycles — there is no self-serve checkout for Team yet,
    // so the yearly toggle reuses the same contact-sales action.
    ctaHrefMonthly: 'mailto:sales@instanode.dev?subject=Team%20plan%20enquiry',
  },
  // Enterprise (task #56, 2026-06-05) — the "contact us" wall above Team.
  // NOT a self-serve tier: no price, no plans.yaml row, no checkout path.
  // It's the GTM landing for anyone who breaches Team's finite caps or needs
  // dedicated/isolated infra, multi-region, or compliance (SOC2/BAA/SSO/SLA/
  // custom DPA). The headline reads "Custom" instead of a dollar figure; the
  // CTA is a sales mailto matching Team's contact address (sales@instanode.dev),
  // with an "Enterprise inquiry" subject. The yearly toggle reuses the same
  // mailto — there is no annual/monthly distinction for a quote-based plan.
  {
    key: 'enterprise',
    name: 'Enterprise',
    monthly: { price: 'Custom', sub: "let's talk" },
    cta: 'Contact us →',
    ctaHrefMonthly: 'mailto:sales@instanode.dev?subject=Enterprise%20inquiry',
  },
]

type Cell =
  | string
  | { mark: 'check' | 'dash' }
  | { text: string; comingSoon?: boolean }
// Row values are a 5-tuple in column order: Anonymous, Hobby, Pro, Team,
// Enterprise. (Hobby Plus removed from the marketing matrix on 2026-05-15 —
// it lives in plans.yaml + dashboard upsell flows only. Enterprise added
// 2026-06-05 as a contact-us wall — task #56.) The order MUST stay in
// lock-step with the TIERS array above.
type Row = { label: string; sub?: string; values: [Cell, Cell, Cell, Cell, Cell] }

// CUSTOM — Enterprise-column marker. Enterprise is a quote-based "contact us"
// wall, NOT a self-serve tier, so every Enterprise cell reads "Custom" rather
// than a number. We deliberately do NOT use the retired word "unlimited" here
// (the strict-margin redesign retired it across the surface). Kept as a named
// const so a future copy change touches one place, not every row.
const CUSTOM: Cell = 'Custom'

// strict-80% margin redesign (2026-06-05): Team is no longer "unlimited" —
// every Team limit is now a finite plans.yaml cap rendered directly in the
// Team column below. The former `UNLIMITED` cell helper was removed; anyone
// needing MORE than the finite Team caps is routed to Enterprise (contact
// sales), surfaced in the Team tier description + the section copy.

// Each row has 5 cells: [Anonymous, Hobby, Pro, Team, Enterprise]. Numbers
// come from api/plans.yaml for the four self-serve columns. 2026-05-15: Hobby
// Plus column removed (the tier exists for upsell flows but is not part of the
// public ladder); Pro storage bumped per PRICING-AUDIT-2026-05-15.md
// (Postgres 5→10 GB, Redis 256→512 MB, Mongo 2→5 GB, object 10→50 GB).
// strict-80% margin redesign (2026-06-05): every Team -1 ("unlimited")
// replaced with the finite plans.yaml cap (Postgres 50 GB / 100 conn,
// Redis 1.5 GB, Mongo 40 GB / 50 conn, Queue 40 GB, Vector 30 GB, Storage
// 300 GB, Webhooks 100k, Deploy apps 100, Vault 1000). Pro queue trimmed
// 10 GB → 5 GB in the same pass.
// task #56 (2026-06-05): Enterprise column added on the right. It is a
// "contact us" wall, NOT a plans.yaml tier — every Enterprise cell reads
// CUSTOM ("Custom"), never a number and never "unlimited". For the
// SSO/SAML + SLA rows (not-yet-shipped everywhere else) Enterprise reads
// 'Contact us' since those are exactly the asks that route to sales.
const ROWS: Row[] = [
  { label: 'Postgres', values: ['10 MB / 2 conn / 24h TTL', '1 GB / 8 conn',     '10 GB / 20 conn', '50 GB / 100 conn', CUSTOM] },
  { label: 'Redis',    values: ['5 MB / 24h TTL',           '50 MB',             '512 MB',          '1.5 GB',           CUSTOM] },
  { label: 'MongoDB',  values: ['5 MB / 2 conn / 24h TTL',  '100 MB / 5 conn',   '5 GB / 20 conn',  '40 GB / 50 conn',  CUSTOM] },
  // FIX-G (2026-05-14): the column used to advertise "1 000 / 5 000 / 100k
  // msg/d" but there's no backing queue_messages_per_day field on the
  // plans.yaml side — quota enforcement is on queue_storage_mb. Numbers
  // mirror plans.yaml queue_storage_mb (anon=64 MB, hobby=2 GB, pro=5 GB,
  // team=40 GB) after the 2026-06-05 strict-margin trim.
  { label: 'Queue',    sub: 'NATS storage', values: ['64 MB / 24h TTL', '2 GB', '5 GB', '40 GB', CUSTOM] },
  // Vector — plans.yaml vector_storage_mb: anon=10 MB, hobby=500 MB,
  // pro=10 GB, team=30 GB (strict-margin 2026-06-05).
  { label: 'Vector',   sub: 'pgvector', values: ['10 MB / 24h TTL', '500 MB', '10 GB', '30 GB', CUSTOM] },
  // Anonymous storage: plans.yaml storage_storage_mb=10 (anonymous tier).
  // PB04 P1 (2026-05-21): cell used to render '—' which contradicted the
  // shipped backend — anonymous /storage/new returns a real 10 MB bucket.
  { label: 'Storage',  values: ['10 MB / 24h TTL',              '512 MB',           '50 GB',          '300 GB',           CUSTOM] },
  { label: 'Webhook stored', values: ['100',                   '1 000',            '10k',            '100k',             CUSTOM] },
  // 2026-05-20: dropped "small / medium" pod-size adjectives — there is no
  // deployment_size field on api/internal/handlers/deploy.go. Numbers map
  // to plans.yaml deployments_apps (hobby=1, pro=10, team=100 finite).
  { label: 'Deploy apps', values: [{ mark: 'dash' },           '1',                '10',             '100',              CUSTOM] },
  { label: 'Domains',  values: [{ mark: 'dash' }, '*.deployment.instanode.dev', 'custom domain', '50 custom domains', CUSTOM] },
  // Multi-env workflows (stack promotion + vault copy across envs) is a
  // shipped Pro-tier feature: POST /api/v1/stacks/:slug/promote and
  // POST /api/v1/vault/copy are live (RETRO-2026-05-12 §10.17). Hobby is
  // single-env (production only).
  { label: 'Multi-env workflows', sub: 'stack promotion + vault copy', values: [{ mark: 'dash' }, { mark: 'dash' }, 'dev / staging / prod', 'dev / staging / prod', CUSTOM] },
  { label: 'RBAC + audit', values: [{ mark: 'dash' }, { mark: 'dash' }, { mark: 'dash' }, { mark: 'check' }, { mark: 'check' }] },
  { label: 'Vault entries', values: [{ mark: 'dash' }, '20', '200', '1 000', CUSTOM] },
  { label: 'Vault envs',    values: [{ mark: 'dash' }, 'production only', 'multi-env', 'multi-env', 'multi-env'] },
  { label: 'Backups',       values: [{ mark: 'dash' }, '7-day · no restore', '30-day · 1-click restore', '90-day · self-serve restore', 'Custom retention'] },
  // SSO/SAML + SLA have no backend yet — shown as not-yet-available on the
  // self-serve tiers (gap analysis 2026-06-03), consistent with PricingGrid +
  // llms.txt "coming soon". Enterprise reads 'Contact us' because these are
  // exactly the compliance/SLA asks that route to sales today.
  { label: 'SSO / SAML (coming soon)', values: [{ mark: 'dash' }, { mark: 'dash' }, { mark: 'dash' }, { mark: 'dash' }, 'Contact us'] },
  { label: '99.9% SLA (coming soon)',  values: [{ mark: 'dash' }, { mark: 'dash' }, { mark: 'dash' }, { mark: 'dash' }, 'Contact us'] }
]

const FAQ: { q: string; a: string }[] = [
  {
    q: 'What does anonymous mean?',
    a: "Your agent calls /db/new without auth. Resources expire in 24 h unless claimed via the link in the response."
  },
  {
    // B2-P1-3 (BugBash 2026-05-20): the hero subhead "Free for the first
    // agent call" is intentionally agent-centric, but a paying user
    // reading the pricing table needs the unambiguous reassurance that
    // Hobby/Pro/Team are pay-from-day-one — no trial period, no surprise
    // charge after 14 days. Mirrors MEMORY.md: "anonymous (24h TTL) is
    // the only free tier; hobby/pro/team are paid from signup."
    q: 'Is there a free trial on Hobby, Pro, or Team?',
    a: "No — you pay from day one. The anonymous tier (24h TTL) is the only free option; once you upgrade to Hobby, Pro, or Team you're billed at the listed rate immediately. Existing anonymous resources you claim before upgrading keep their data; they just get the paid tier's limits going forward."
  },
  {
    // B2-P1-4 (BugBash 2026-05-20): Hobby Plus + Growth exist as real
    // tiers in api/plans.yaml but are intentionally absent from the
    // public ladder — they're API-only intermediate steps offered via
    // dashboard upsell flows (quota wall nudges, custom-domain prompts).
    // Calling this out on the public surface stops customers from
    // emailing us asking "what's $19/mo or $99/mo?".
    q: 'What are Hobby Plus and Growth — I see them in the API?',
    a: "Intermediate tiers ($19/mo and $99/mo) summarized above under \"Between the headline tiers\". They sit between Hobby/Pro and Pro/Team and are surfaced to existing customers as upgrade nudges (e.g. when a Hobby team hits 80% of its quota). They're not in the headline ladder on purpose — three public tiers are a cleaner first-time funnel. If you want them, ask in the dashboard or email support@instanode.dev."
  },
  {
    // W12 H14: previous copy said "Cancel anytime" which contradicted the
    // platform's no-self-serve-cancel policy. The honest answer matches
    // the BillingPage copy: cancellation is support-only with a 24h SLA.
    q: 'How is billing handled?',
    a: "Razorpay subscriptions. Cancel by emailing support@instanode.dev — we'll process within 24h. Existing resources keep their tier until the end of the current period."
  },
  {
    q: 'Can I move resources between envs?',
    a: 'Yes — Pro and Team include multi-env workflows: POST /api/v1/stacks/:slug/promote moves a stack from staging to production (config + resource bindings preserved), and POST /api/v1/vault/copy bulk-copies vault secrets across envs with a dry-run preview. Hobby is single-env (production only).'
  },
  {
    // P2-29: downgrades are support-only, not self-serve — matches the
    // platform's no-self-serve-cancel/downgrade policy and the sibling
    // billing FAQ above. The previous copy implied a self-serve toggle.
    q: 'What happens if I downgrade?',
    a: "Downgrades are handled by support — email support@instanode.dev and we'll process within 24h. Existing resources retain their old tier limits as a courtesy; new provisions follow the new tier."
  }
]

const TRY_CURL = `curl -X POST https://api.instanode.dev/db/new -d '{"name":"prod-db"}'`

export function PricingPage() {
  // P2: monthly/yearly toggle, persisted in localStorage. Default monthly.
  // Hydrates from storage on mount (after first paint) so SSR output is
  // stable and search engines see the canonical monthly view.
  const [frequency, setFrequencyState] = useState<PricingFrequency>('monthly')

  // B2-P1-1 / B2-P1-2 (BugBash 2026-05-20): read ?frequency, ?tier, and
  // location.hash on mount so shareable links work. URL param wins over
  // localStorage so a marketing CTA like /pricing?frequency=yearly always
  // lands the visitor on the yearly view, even if their previous visit
  // saved 'monthly' to localStorage.
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const tierParam = searchParams.get('tier')
  const tierHash = location.hash.replace(/^#/, '').toLowerCase()
  const requestedTier = tierParam || tierHash

  useEffect(() => {
    if (typeof window === 'undefined') return
    // 1. ?frequency param takes precedence over localStorage. This is
    //    the shareable-link entry path; localStorage is the
    //    return-visitor preference fallback.
    const freqParam = searchParams.get('frequency')
    if (freqParam === 'yearly' || freqParam === 'monthly') {
      setFrequencyState(freqParam)
      try { window.localStorage.setItem(FREQ_STORAGE_KEY, freqParam) } catch { /* non-fatal */ }
      return
    }
    // 2. Fall back to last-used preference.
    try {
      const v = window.localStorage.getItem(FREQ_STORAGE_KEY)
      if (v === 'yearly') setFrequencyState('yearly')
    } catch { /* private mode / disabled storage — keep default */ }
  }, [searchParams])

  // Scroll the requested tier into view + highlight it briefly. We do this
  // after the layout settles (50ms) so the scroll lands on the column
  // header, not a half-mounted body. The highlight class is removed after
  // 1.5s — long enough to draw the eye, short enough to feel intentional.
  useEffect(() => {
    if (!requestedTier) return
    if (typeof document === 'undefined') return
    const valid = ['anonymous', 'hobby', 'pro', 'team', 'enterprise']
    if (!valid.includes(requestedTier)) return
    const t = window.setTimeout(() => {
      const el = document.getElementById(`pricing-tier-${requestedTier}`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('pricing-tier-flash')
      window.setTimeout(() => el.classList.remove('pricing-tier-flash'), 1500)
    }, 50)
    return () => window.clearTimeout(t)
  }, [requestedTier])

  const setFrequency = (f: PricingFrequency) => {
    setFrequencyState(f)
    try {
      if (typeof window !== 'undefined') window.localStorage.setItem(FREQ_STORAGE_KEY, f)
    } catch { /* non-fatal */ }
  }

  return (
    <PublicShell>
      <PricingStyles />

      {/* ---------- Header ---------- */}
      <section className="pricing-header">
        <span className="public-eyebrow">Pricing · transparent · per-team</span>
        <h1 className="public-h1">
          Pricing<span className="dot">.</span>
        </h1>
        <p className="public-sub">
          Free for the first agent call. Pay when your agent grows up.
        </p>
      </section>

      {/* ---------- Tier comparison table ---------- */}
      <section className="public-section" aria-labelledby="compare-h">
        <h2 id="compare-h" className="public-section-h">Compare tiers</h2>
        <p className="public-section-sub">
          All prices in USD. Limits enforced per team. Numbers come from <code className="pr-inline">plans.yaml</code>.
          Need more than Team's caps — or dedicated infra, multi-region, or compliance? That's <strong>Enterprise</strong>: custom, contact us.
        </p>

        {/* P2: monthly / yearly toggle. Pure-presentational on the
            marketing page — clicking a CTA passes ?frequency=… along to
            the in-product checkout flow. */}
        <PricingFrequencyToggle frequency={frequency} onChange={setFrequency} />

        <div className="pricing-table" role="table" aria-label="Pricing comparison">
          {/* tier header row */}
          <div className="pricing-row pricing-row--head" role="row">
            <div className="pricing-cell pricing-cell--feature" role="columnheader">Feature</div>
            {TIERS.map((t) => {
              // Pick the price block for the selected frequency, falling
              // back to monthly when the tier has no yearly variant (free
              // anonymous tier has no annual deal).
              const showYearly = frequency === 'yearly' && !!t.yearly
              const price = showYearly ? t.yearly! : t.monthly
              return (
                <div
                  key={t.key}
                  // B2-P1-2 (BugBash 2026-05-20): #hobby/#pro/#team anchors used
                  // to silently no-op because no element on the page had
                  // matching ids. The id="pricing-tier-<key>" lets a shareable
                  // link like /pricing#pro or /pricing?tier=pro scroll the
                  // column into view (handled in the useEffect at the top of
                  // PricingPage). Stable id derived from the tier key so the
                  // selector survives copy renames.
                  id={`pricing-tier-${t.key}`}
                  className={`pricing-cell pricing-cell--tier${t.highlighted ? ' is-highlighted' : ''}`}
                  role="columnheader"
                  data-tier={t.key}
                  data-frequency={showYearly ? 'yearly' : 'monthly'}
                >
                  <div className="pricing-tier-name">
                    {t.name}
                    {t.comingSoon && <span className="pricing-tier-soon">soon</span>}
                  </div>
                  <div className="pricing-tier-price">
                    <span className="pricing-tier-num">{price.price}</span>
                    <span className="pricing-tier-sub">{price.sub}</span>
                  </div>
                  {showYearly && t.yearly?.saveLabel && (
                    /* BugBash B2-P2-5: green-on-near-transparent-green
                       was failing 4.5:1 small-text AA. Bumped font-size
                       from 10.5 → 11, weight to 500, and darkened the
                       border + filled the background to push the ratio
                       above 5:1 against #08080a (--ink) without changing
                       the visual brand. */
                    <span
                      data-testid={`pricing-save-${t.key}`}
                      style={{
                        marginTop: 4,
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        fontWeight: 500,
                        color: 'var(--accent)',
                        border: '1px solid rgba(0,228,142,0.55)',
                        background: 'rgba(0,228,142,0.15)',
                        letterSpacing: '0.04em',
                        alignSelf: 'flex-start',
                      }}
                    >
                      {t.yearly.saveLabel}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* feature rows */}
          {ROWS.map((row) => (
            <div className="pricing-row" key={row.label} role="row">
              <div className="pricing-cell pricing-cell--feature" role="rowheader">
                <span className="pricing-feature-label">{row.label}</span>
                {row.sub && <span className="pricing-feature-sub">{row.sub}</span>}
              </div>
              {row.values.map((v, i) => (
                <div
                  className={`pricing-cell${TIERS[i].highlighted ? ' is-highlighted' : ''}`}
                  role="cell"
                  key={i}
                  data-tier={TIERS[i].key}
                >
                  <CellValue v={v} />
                </div>
              ))}
            </div>
          ))}

          {/* CTA row */}
          <div className="pricing-row pricing-row--cta" role="row">
            <div className="pricing-cell pricing-cell--feature" />
            {TIERS.map((t) => {
              // Pick the matching CTA href for the frequency. When yearly
              // is selected but a tier has no yearly variant (anonymous,
              // or a not-yet-launched tier), fall back to the monthly href
              // so the link doesn't 404.
              const useYearly = frequency === 'yearly' && !!t.ctaHrefYearly
              const ctaHref = useYearly ? t.ctaHrefYearly! : t.ctaHrefMonthly
              return (
                <div
                  key={t.key}
                  className={`pricing-cell${t.highlighted ? ' is-highlighted' : ''}`}
                  role="cell"
                >
                  {t.comingSoon ? (
                    // L-03: the Team tier's `cta` is an empty string, so this
                    // pill rendered as a dead empty rounded box. Fall back to
                    // a "coming soon" label so the cell carries meaning.
                    // B2-P1-5 (BugBash 2026-05-20): data-testid carries
                    // through both the live-link branch and the
                    // coming-soon branch so the Playwright suite can
                    // assert the disabled-state CTA without conditional
                    // selectors. Mirrors the
                    // `pricing-cta-${tier}` selector pattern used by
                    // the live-link branch below.
                    <span
                      className="pricing-cta pricing-cta--disabled"
                      aria-disabled="true"
                      data-testid={`pricing-cta-${t.key}`}
                    >
                      {t.cta || 'Coming soon'}
                    </span>
                  ) : (
                    <a
                      href={ctaHref}
                      className={`pricing-cta${t.highlighted ? ' pricing-cta--primary' : ''}`}
                      data-testid={`pricing-cta-${t.key}`}
                    >
                      {t.cta}
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ---------- Enterprise "contact us" wall (task #56) ---------- */}
      {/* Enterprise sits above Team but is NOT a self-serve tier — no price,
          no plans.yaml row, no checkout. This callout restates who it's for
          using the strict-margin redesign's trigger criteria and routes to the
          same sales address Team uses. Kept tasteful: no invented features, no
          dollar figure, no "unlimited". */}
      <section
        className="public-section"
        id="pricing-tier-enterprise-callout"
        aria-labelledby="enterprise-h"
        data-testid="pricing-enterprise-callout"
      >
        <h2 id="enterprise-h" className="public-section-h">Enterprise</h2>
        <p className="public-section-sub">
          Outgrowing Team, or you need more than self-serve can offer? Let's talk.
        </p>
        <div className="pricing-enterprise-card" data-testid="pricing-enterprise-card">
          <p className="pricing-enterprise-lead">
            Need more than Team's limits, dedicated or isolated infra, multi-region, or
            compliance — SOC2, BAA, SSO, an SLA, or a custom DPA? Enterprise is custom-scoped
            to your team. No price tag, no checkout — a real conversation.
          </p>
          <a
            href="mailto:sales@instanode.dev?subject=Enterprise%20inquiry"
            className="pricing-cta pricing-cta--primary"
            data-testid="pricing-enterprise-cta"
          >
            Contact us →
          </a>
        </div>
      </section>

      {/* ---------- Between-the-ladders note (DOG-3 / BUG-P001) ---------- */}
      {/* Hobby Plus ($19) + Growth ($99) exist in plans.yaml but are
          intentionally not in the public ladder above (cleaner first-time
          funnel). Previously they were ONLY documented in the FAQ — visitors
          who hit Pro's limits without scrolling never knew the intermediate
          step existed. Surface them inline with the comparison so the "Self-
          serve sign-up at every tier" promise above is harder to falsify on
          first glance. Anchor + data-testid lets the FAQ self-link to here. */}
      <section
        className="public-section"
        id="intermediate-tiers"
        aria-labelledby="intermediate-tiers-h"
        data-testid="pricing-intermediate-tiers"
      >
        <h2 id="intermediate-tiers-h" className="public-section-h">Between the headline tiers</h2>
        <p className="public-section-sub">
          Two intermediate plans live behind the dashboard — surfaced as upgrade nudges when
          your usage crosses a Hobby or Pro limit, not as front-page funnel entries.
        </p>
        <ul className="pricing-intermediate-list">
          <li data-testid="intermediate-tier-hobby_plus">
            <strong>Hobby Plus · $19/mo.</strong> Same Postgres + Redis as Hobby, plus a 1 GB
            MongoDB (vs Hobby's 100 MB), 5,000 webhook receivers, and 2 deployments. The
            "outgrew Hobby's Mongo" step.
          </li>
          <li data-testid="intermediate-tier-growth">
            <strong>Growth · $99/mo.</strong> 20 GB MongoDB, 100k webhook receivers, 1 GB Redis,
            20 GB Postgres, 20 GB queue, 150 GB object storage. Pro-tier supporting services
            without committing to Pro's deployment ladder. Yearly billing not yet offered on
            this tier.
          </li>
        </ul>
      </section>

      {/* ---------- FAQ ---------- */}
      <section className="public-section" aria-labelledby="faq-h">
        <h2 id="faq-h" className="public-section-h">FAQ</h2>
        <p className="public-section-sub">Stuff people actually ask before paying.</p>

        <div className="pricing-faq">
          {FAQ.map((item) => (
            <details className="pricing-faq-item" key={item.q}>
              <summary className="pricing-faq-q">
                <span>{item.q}</span>
                <span className="pricing-faq-mark" aria-hidden="true">+</span>
              </summary>
              <p className="pricing-faq-a">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ---------- CTA strip ---------- */}
      <CtaStrip command={TRY_CURL} />
    </PublicShell>
  )
}

/**
 * PricingFrequencyToggle — Monthly | Yearly chooser shown above the
 * pricing table. Mirrors the BillingPage toggle visually so the
 * marketing → checkout experience feels continuous. Pure presentation;
 * persistence happens in the parent.
 */
function PricingFrequencyToggle({
  frequency,
  onChange,
}: {
  frequency: PricingFrequency
  onChange: (f: PricingFrequency) => void
}) {
  return (
    <div
      data-testid="pricing-frequency-toggle"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        margin: '0 0 18px',
        flexWrap: 'wrap',
      }}
    >
      <div
        role="radiogroup"
        aria-label="Billing cycle"
        style={{
          display: 'inline-flex',
          border: '1px solid var(--border-hi, var(--border))',
          borderRadius: 999,
          padding: 2,
          background: 'var(--elevated, var(--surface))',
        }}
      >
        <button
          type="button"
          role="radio"
          aria-checked={frequency === 'monthly'}
          data-testid="pricing-frequency-monthly"
          onClick={() => onChange('monthly')}
          style={{
            borderRadius: 999,
            padding: '6px 16px',
            fontSize: 12,
            background: frequency === 'monthly' ? 'var(--accent)' : 'transparent',
            color: frequency === 'monthly' ? 'var(--ink)' : 'var(--text)',
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'var(--font-display, inherit)',
          }}
        >
          Monthly
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={frequency === 'yearly'}
          data-testid="pricing-frequency-yearly"
          onClick={() => onChange('yearly')}
          style={{
            borderRadius: 999,
            padding: '6px 16px',
            fontSize: 12,
            background: frequency === 'yearly' ? 'var(--accent)' : 'transparent',
            color: frequency === 'yearly' ? 'var(--ink)' : 'var(--text)',
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'var(--font-display, inherit)',
          }}
        >
          Yearly
        </button>
      </div>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--text-dim)',
          letterSpacing: '0.04em',
        }}
      >
        Yearly saves ~17% across Hobby, Pro, and Team.
      </span>
    </div>
  )
}

function CellValue({ v }: { v: Cell }) {
  if (typeof v === 'string') return <span className="pricing-cell-text">{v}</span>
  if ('mark' in v) {
    if (v.mark === 'check') return <span className="pricing-mark pricing-mark--check" aria-label="included">✓</span>
    return <span className="pricing-mark pricing-mark--dash" aria-label="not included">—</span>
  }
  // { text, comingSoon? } — text may be empty (badge-only cell)
  return (
    <span className="pricing-cell-text" style={{ opacity: v.comingSoon ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {v.text}
      {v.comingSoon && (
        <span style={{
          padding: '1px 6px', fontSize: 10,
          fontFamily: 'var(--font-mono)', color: 'var(--violet)',
          border: '1px solid rgba(183,148,246,0.3)', borderRadius: 4,
          textTransform: 'uppercase', letterSpacing: 0.06,
        }}>soon</span>
      )}
    </span>
  )
}

function CtaStrip({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    const ok = await copyToClipboard(command)
    if (!ok) {
      console.warn('[PricingPage] copy failed — clipboard unavailable')
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }
  return (
    <section className="public-section pricing-cta-strip" id="try-curl" aria-labelledby="try-h">
      <div className="pricing-cta-inner">
        <div>
          <h2 id="try-h" className="pricing-cta-h">Try it without signup</h2>
          <p className="pricing-cta-sub">
            One HTTP call. Real Postgres. Connection string in under 2 s.
          </p>
        </div>
        <div className="pricing-cta-curl">
          <code className="pricing-cta-code">{command}</code>
          <button
            type="button"
            className="pricing-cta-copy"
            onClick={onCopy}
            aria-label="Copy curl command to clipboard"
          >
            {copied ? 'copied' : 'copy'}
          </button>
        </div>
      </div>
    </section>
  )
}

/* ----- Page-local styles ----- */
function PricingStyles() {
  return (
    <style>{`
      .pricing-header { padding-top: 8px; }
      .pr-inline {
        font-family: var(--font-mono);
        font-size: 12px;
        background: var(--code-bg);
        border: 1px solid var(--border);
        padding: 1px 6px; border-radius: 4px;
        color: var(--text);
      }

      /* table */
      .pricing-table {
        border: 1px solid var(--border-hi);
        border-radius: 14px;
        overflow: hidden;
        background: var(--surface);
      }
      .pricing-row {
        display: grid;
        /* 1 feature col + 5 tier cols. The TIERS array has exactly five
           entries: Anonymous, Hobby, Pro, Team, Enterprise (added 2026-06-05,
           task #56). hobby_plus stays out of the marketing matrix (upsell-only).
           The Enterprise column carries short "Custom" / "Contact us" copy, so
           it gets a slightly narrower track (0.9fr) than the numeric tiers. */
        grid-template-columns: 1.3fr 1fr 1fr 1fr 1fr 0.9fr;
        align-items: stretch;
        border-bottom: 1px solid var(--border);
      }
      .pricing-row:last-child { border-bottom: 0; }
      .pricing-row--head {
        background: var(--elevated);
      }
      .pricing-row--cta { background: var(--ink); }

      .pricing-cell {
        padding: 14px 18px;
        font-size: 13px;
        color: var(--text);
        display: flex; flex-direction: column; gap: 4px; justify-content: center;
        border-left: 1px solid var(--border);
      }
      .pricing-cell:first-child { border-left: 0; }
      .pricing-cell--feature {
        font-family: var(--font-display);
        color: var(--text);
      }
      .pricing-cell--tier { padding-top: 22px; padding-bottom: 22px; gap: 8px; }
      .pricing-cell.is-highlighted {
        background: linear-gradient(180deg, rgba(0,228,142,0.05), transparent 70%);
        position: relative;
      }
      .pricing-row--head .pricing-cell.is-highlighted {
        background: linear-gradient(180deg, rgba(0,228,142,0.1), rgba(0,228,142,0.02));
      }
      .pricing-cell.is-highlighted::after {
        content: ""; position: absolute; left: 0; right: 0; bottom: 0;
        height: 1px; background: var(--accent); opacity: 0.25;
      }

      .pricing-tier-name {
        font-size: 15px; font-weight: 500;
        letter-spacing: -0.01em;
      }
      .pricing-tier-price {
        display: flex; align-items: baseline; gap: 6px;
        font-family: var(--font-display);
      }
      .pricing-tier-num {
        font-size: 28px; font-weight: 400;
        letter-spacing: -0.03em;
      }
      .pricing-tier-sub {
        font-family: var(--font-mono);
        font-size: 11px; color: var(--text-dim);
      }

      .pricing-feature-label { font-weight: 500; font-size: 13px; }
      .pricing-feature-sub {
        font-family: var(--font-mono);
        font-size: 10.5px; color: var(--text-faint);
        text-transform: uppercase; letter-spacing: 0.06em;
      }

      .pricing-cell-text {
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--text);
      }
      .pricing-mark {
        font-family: var(--font-mono);
        font-size: 14px;
        line-height: 1;
      }
      .pricing-mark--check { color: var(--accent); }
      .pricing-mark--dash { color: var(--text-ghost); }

      .pricing-cta {
        display: inline-flex; justify-content: center; align-items: center;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 12.5px;
        font-weight: 500;
        color: var(--text);
        background: var(--elevated);
        border: 1px solid var(--border-hi);
        transition: all 150ms;
        white-space: nowrap;
      }
      .pricing-cta:hover { border-color: #3a3a48; background: var(--raised); }
      .pricing-cta--primary {
        background: var(--accent);
        color: var(--ink);
        font-weight: 600;
        border-color: var(--accent-deep);
        box-shadow: 0 0 0 1px var(--accent-deep) inset;
      }
      .pricing-cta--primary:hover { background: #28edA0; }
      .pricing-cta--disabled {
        opacity: 0.55;
        cursor: not-allowed;
        background: transparent;
        color: var(--text-faint);
      }
      .pricing-cta--disabled:hover { background: transparent; }
      .pricing-tier-soon {
        display: inline-block;
        margin-left: 8px;
        padding: 1px 6px;
        font-size: 0.65em;
        font-weight: 500;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--ink);
        background: var(--amber, #f5b13c);
        border-radius: 3px;
        vertical-align: middle;
      }

      /* B2-P1-2 (BugBash 2026-05-20): /pricing?tier=pro and /pricing#pro
         shareable links scroll the matching column into view and pulse
         it briefly. The flash class is added by the useEffect at the
         top of PricingPage and removed 1.5s later. Box-shadow rather
         than background so the cell content stays readable. */
      .pricing-tier-flash {
        animation: pricing-tier-flash-anim 1500ms ease-out;
      }
      @keyframes pricing-tier-flash-anim {
        0%   { box-shadow: 0 0 0 0 rgba(0,228,142,0.6); }
        25%  { box-shadow: 0 0 0 6px rgba(0,228,142,0.3); }
        100% { box-shadow: 0 0 0 0 rgba(0,228,142,0); }
      }

      @media (max-width: 880px) {
        .pricing-row { grid-template-columns: 1fr; }
        .pricing-cell { border-left: 0; border-bottom: 1px dashed var(--border); }
        .pricing-cell:last-child { border-bottom: 0; }
        .pricing-row--head .pricing-cell { border-bottom: 1px solid var(--border); }
        .pricing-cell--feature { background: var(--elevated); }
      }

      /* task #56: Enterprise "contact us" wall card */
      .pricing-enterprise-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        flex-wrap: wrap;
        border: 1px solid rgba(0,228,142,0.25);
        border-radius: 14px;
        padding: 22px 24px;
        background: linear-gradient(135deg, rgba(0,228,142,0.06), rgba(0,228,142,0.02));
      }
      .pricing-enterprise-lead {
        font-size: 14px;
        line-height: 1.6;
        color: var(--text-dim);
        max-width: 640px;
        margin: 0;
      }
      .pricing-enterprise-card .pricing-cta { white-space: nowrap; }

      /* DOG-3: intermediate tiers list (Hobby Plus + Growth callout) */
      .pricing-intermediate-list {
        list-style: none;
        padding: 0; margin: 0;
        display: grid;
        gap: 12px;
        grid-template-columns: 1fr;
      }
      @media (min-width: 720px) {
        .pricing-intermediate-list { grid-template-columns: 1fr 1fr; }
      }
      .pricing-intermediate-list > li {
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 16px 18px;
        background: var(--ink);
        font-size: 13.5px;
        color: var(--text-dim);
        line-height: 1.55;
        max-width: 540px;
      }
      .pricing-intermediate-list > li strong {
        color: var(--text);
        font-weight: 600;
        margin-right: 4px;
      }

      /* faq */
      .pricing-faq {
        display: flex; flex-direction: column;
        border: 1px solid var(--border);
        border-radius: 12px;
        overflow: hidden;
        background: var(--ink);
      }
      .pricing-faq-item {
        border-bottom: 1px solid var(--border);
      }
      .pricing-faq-item:last-child { border-bottom: 0; }
      .pricing-faq-q {
        list-style: none;
        cursor: pointer;
        padding: 18px 20px;
        font-size: 14.5px; font-weight: 500;
        color: var(--text);
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px;
        transition: background 120ms;
      }
      .pricing-faq-q::-webkit-details-marker { display: none; }
      .pricing-faq-item[open] .pricing-faq-q { background: var(--elevated); }
      .pricing-faq-mark {
        font-family: var(--font-mono);
        font-size: 16px; color: var(--text-faint);
        transition: transform 200ms, color 200ms;
      }
      .pricing-faq-item[open] .pricing-faq-mark {
        transform: rotate(45deg); color: var(--accent);
      }
      .pricing-faq-a {
        padding: 0 20px 20px;
        font-size: 13.5px; color: var(--text-dim);
        line-height: 1.6;
        max-width: 720px;
      }

      /* cta strip */
      .pricing-cta-strip { margin-top: 96px; }
      .pricing-cta-inner {
        display: flex; align-items: center; justify-content: space-between; gap: 32px;
        padding: 28px 32px;
        background: linear-gradient(135deg, rgba(0,228,142,0.08), rgba(0,228,142,0.02));
        border: 1px solid rgba(0,228,142,0.25);
        border-radius: 14px;
      }
      @media (max-width: 760px) {
        .pricing-cta-inner { flex-direction: column; align-items: flex-start; padding: 22px 20px; }
      }
      .pricing-cta-h {
        font-family: var(--font-display);
        font-size: 22px; font-weight: 400;
        letter-spacing: -0.02em;
        margin-bottom: 6px;
      }
      .pricing-cta-sub {
        font-size: 13.5px; color: var(--text-dim);
      }
      .pricing-cta-curl {
        display: flex; align-items: center; gap: 8px;
        background: var(--code-bg);
        border: 1px solid var(--border-hi);
        border-radius: 8px;
        padding: 8px 8px 8px 14px;
        min-width: 0;
        max-width: 100%;
      }
      .pricing-cta-code {
        font-family: var(--font-mono);
        font-size: 12.5px;
        color: var(--text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pricing-cta-copy {
        font-family: var(--font-mono);
        font-size: 11px;
        padding: 6px 12px;
        background: var(--elevated);
        border: 1px solid var(--border-hi);
        color: var(--text-dim);
        border-radius: 5px;
        transition: all 120ms;
      }
      .pricing-cta-copy:hover { color: var(--accent); border-color: rgba(0,228,142,0.35); }
    `}</style>
  )
}
