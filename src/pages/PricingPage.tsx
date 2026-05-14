/* PricingPage — public marketing page at /pricing.
   All numbers/prices come from the spec; nothing invented.
   Wrapped in PublicShell for the glassmorphic top nav + footer. */

import { useEffect, useState } from 'react'
import { PublicShell } from '../layout/PublicShell'
import { copyToClipboard } from '../components/Common'

type TierKey = 'anonymous' | 'hobby' | 'pro' | 'team'

// P2: monthly vs yearly pricing. The toggle on this page is purely
// presentational — the CTA passes the chosen cycle through as
// `?frequency=yearly` so the in-product checkout flow can read it.
// Numbers come from api/plans.yaml; the effective monthly is the annual
// total divided by 12, rounded to two decimals for display.
type PricingFrequency = 'monthly' | 'yearly'

const FREQ_STORAGE_KEY = 'instant.billing.plan_frequency'

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
    cta: 'Try the curl',
    ctaHrefMonthly: '#try-curl',
  },
  {
    key: 'hobby',
    name: 'Hobby',
    monthly: { price: '$9', sub: '/ mo' },
    yearly: { price: '$7.50', sub: '/ mo billed yearly', saveLabel: 'save $18/yr' },
    cta: 'Start hobby →',
    ctaHrefMonthly: '/checkout?plan=hobby&frequency=monthly',
    ctaHrefYearly: '/checkout?plan=hobby&frequency=yearly',
  },
  {
    key: 'pro',
    name: 'Pro',
    monthly: { price: '$49', sub: '/ mo' },
    yearly: { price: '$40.83', sub: '/ mo billed yearly', saveLabel: 'save $98/yr' },
    cta: 'Start pro →',
    ctaHrefMonthly: '/checkout?plan=pro&frequency=monthly',
    ctaHrefYearly: '/checkout?plan=pro&frequency=yearly',
    highlighted: true,
  },
  // Team tier is under active development — visible so customers can see the
  // roadmap but disabled (no checkout, no signup). Backend k8s plumbing for
  // team-scale dedicated infra is already in place; what's pending is the
  // multi-seat + RBAC + SSO surface.
  {
    key: 'team',
    name: 'Team',
    monthly: { price: '$199', sub: '/ mo' },
    yearly: { price: '$165.83', sub: '/ mo billed yearly', saveLabel: 'save $398/yr' },
    // Self-serve checkout for Team is still being wired (multi-seat / RBAC
    // UI). The Razorpay yearly plan and dedicated-infra k8s plumbing both
    // exist, so the tier is sellable via enterprise@ today. Dropping
    // `comingSoon` so the CTA renders as a clickable mailto link instead of
    // a disabled span; per-feature SOON markers in the matrix below still
    // flag the specific gaps (SSO, RBAC, audit-export) honestly.
    cta: 'Contact sales →',
    ctaHrefMonthly: 'mailto:enterprise@instanode.dev?subject=Team%20tier%20inquiry',
    ctaHrefYearly: 'mailto:enterprise@instanode.dev?subject=Team%20tier%20annual%20inquiry',
  },
]

type Cell =
  | string
  | { mark: 'check' | 'dash' }
  | { text: string; comingSoon?: boolean }
type Row = { label: string; sub?: string; values: [Cell, Cell, Cell, Cell] }

// Team-tier values use { text: '', comingSoon: true } across the board because
// the tier isn't shipped — claiming "unlimited" for capacity we haven't
// delivered would be misleading. Once team launches, replace these with the
// real numbers from plans.yaml.
const SOON: Cell = { text: '', comingSoon: true }

const ROWS: Row[] = [
  { label: 'Postgres', values: ['10 MB / 2 conn / 24h TTL', '1 GB / 8 conn', '5 GB / 20 conn', SOON] },
  { label: 'Redis',    values: ['5 MB / 24h TTL', '50 MB',           '256 MB',         SOON] },
  { label: 'MongoDB',  values: ['5 MB / 2 conn / 24h TTL',  '100 MB / 5 conn', '2 GB / 20 conn', SOON] },
  { label: 'Queue',    sub: 'NATS', values: ['24 h TTL', '1 000 msg/d', '100k msg/d', SOON] },
  { label: 'Storage',  values: [{ mark: 'dash' }, '1 bucket',  '5 buckets',  SOON] },
  { label: 'Webhook stored', values: ['100', '1 000', '10k', SOON] },
  { label: 'Deploy apps', values: [{ mark: 'dash' }, '1 small', '10 medium', SOON] },
  { label: 'Domains',  values: [{ mark: 'dash' }, '*.deployment.instanode.dev', 'custom domain', SOON] },
  // Multi-env workflows (stack promotion + vault copy across envs) is a
  // shipped Pro-tier feature: POST /api/v1/stacks/:slug/promote and
  // POST /api/v1/vault/copy are live (RETRO-2026-05-12 §10.17). Hobby is
  // single-env (production only); Pro / Team unlock dev / staging / prod
  // with parent_stack_id linkage.
  { label: 'Multi-env workflows', sub: 'stack promotion + vault copy', values: [{ mark: 'dash' }, { mark: 'dash' }, 'dev / staging / prod', SOON] },
  { label: 'RBAC + audit', values: [{ mark: 'dash' }, { mark: 'dash' }, { mark: 'dash' }, SOON] },
  { label: 'Vault entries', values: [{ mark: 'dash' }, '20', '200', SOON] },
  { label: 'Vault envs',    values: [{ mark: 'dash' }, 'production only', 'multi-env', SOON] },
  { label: 'SSO / SAML', values: [{ mark: 'dash' }, { mark: 'dash' }, { mark: 'dash' }, SOON] },
  { label: '99.9% SLA',  values: [{ mark: 'dash' }, { mark: 'dash' }, { mark: 'dash' }, SOON] }
]

const FAQ: { q: string; a: string }[] = [
  {
    q: 'What does anonymous mean?',
    a: "Your agent calls /db/new without auth. Resources expire in 24 h unless claimed via the link in the response."
  },
  {
    q: 'How is billing handled?',
    a: 'Razorpay subscriptions. Cancel anytime; existing resources keep their tier until the end of the current period.'
  },
  {
    q: 'Can I move resources between envs?',
    a: 'Yes — Pro and Team include multi-env workflows: POST /api/v1/stacks/:slug/promote moves a stack from staging to production (config + resource bindings preserved), and POST /api/v1/vault/copy bulk-copies vault secrets across envs with a dry-run preview. Hobby is single-env (production only).'
  },
  {
    q: 'What happens if I downgrade?',
    a: 'Existing resources retain their old tier limits as a courtesy. New provisions follow the new tier.'
  }
]

const TRY_CURL = 'curl -X POST https://api.instanode.dev/db/new'

export function PricingPage() {
  // P2: monthly/yearly toggle, persisted in localStorage. Default monthly.
  // Hydrates from storage on mount (after first paint) so SSR output is
  // stable and search engines see the canonical monthly view.
  const [frequency, setFrequencyState] = useState<PricingFrequency>('monthly')
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return
      const v = window.localStorage.getItem(FREQ_STORAGE_KEY)
      if (v === 'yearly') setFrequencyState('yearly')
    } catch { /* private mode / disabled storage — keep default */ }
  }, [])
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
                    <span
                      data-testid={`pricing-save-${t.key}`}
                      style={{
                        marginTop: 4,
                        padding: '1px 6px',
                        borderRadius: 4,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10.5,
                        color: 'var(--accent)',
                        border: '1px solid rgba(0,228,142,0.35)',
                        background: 'rgba(0,228,142,0.07)',
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
                    <span className="pricing-cta pricing-cta--disabled" aria-disabled="true">
                      {t.cta}
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
        grid-template-columns: 1.4fr 1fr 1fr 1fr 1fr;
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

      @media (max-width: 880px) {
        .pricing-row { grid-template-columns: 1fr; }
        .pricing-cell { border-left: 0; border-bottom: 1px dashed var(--border); }
        .pricing-cell:last-child { border-bottom: 0; }
        .pricing-row--head .pricing-cell { border-bottom: 1px solid var(--border); }
        .pricing-cell--feature { background: var(--elevated); }
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
