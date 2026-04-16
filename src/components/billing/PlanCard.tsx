import styles from './BillingComponents.module.css';

const PLAN_PRICES: Record<string, string> = {
  anonymous: '$0',
  hobby: '$9/mo',
  pro: '$49/mo',
  team: '$199/mo',
};

function humanizeStatus(status: string, subStatus?: string): string {
  const s = (subStatus || status).toLowerCase();
  if (s === 'active') return 'Active';
  if (s === 'cancelled' || s === 'canceled') return 'Cancelled';
  if (s === 'halted') return 'Payment issue';
  if (s === 'pending_payment' || s === 'pending' || s === 'authenticated') return 'Pending';
  if (s === 'completed' || s === 'expired') return 'Ended';
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : '—';
}

export interface PlanCardProps {
  plan: string;
  billingStatus: string;
  subscriptionStatus?: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd?: boolean;
  razorpayConfigured: boolean;
  onChangePlan: () => void;
  onCancel: () => void;
  showManage: boolean;
}

export function PlanCard({
  plan,
  billingStatus,
  subscriptionStatus,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  razorpayConfigured,
  onChangePlan,
  onCancel,
  showManage,
}: PlanCardProps) {
  const tier = plan.toLowerCase();
  const price = PLAN_PRICES[tier] ?? '';
  const nextLine =
    currentPeriodEnd != null && currentPeriodEnd !== ''
      ? new Date(currentPeriodEnd).toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })
      : null;

  return (
    <div className={styles.card}>
      <p className={styles.cardTitle}>Current plan</p>
      <div className={styles.planHeaderRow}>
        <span className={`${styles.planBadge} ${styles[tier] ?? ''}`} data-testid="billing-plan-tier">
          {tier}
        </span>
        <span className={styles.planPrice}>{price}</span>
      </div>
      <dl className={styles.metaGrid}>
        <dt>Status</dt>
        <dd data-testid="billing-status">{humanizeStatus(billingStatus, subscriptionStatus)}</dd>
        {nextLine && (
          <>
            <dt>Next billing</dt>
            <dd data-testid="billing-next-period">{nextLine}</dd>
          </>
        )}
        {cancelAtPeriodEnd && (
          <>
            <dt>Cancellation</dt>
            <dd className={styles.notice}>Ends at period end</dd>
          </>
        )}
      </dl>
      {showManage && razorpayConfigured && (
        <div className={styles.ctaRow}>
          <button type="button" className={styles.btnSecondary} onClick={onChangePlan} data-testid="billing-change-plan">
            Change plan
          </button>
          <button type="button" className={styles.btnDanger} onClick={onCancel} data-testid="billing-cancel-plan">
            Cancel plan
          </button>
        </div>
      )}
      {showManage && !razorpayConfigured && (
        <p className={styles.hint}>Billing is not configured — manage subscription from the Razorpay dashboard.</p>
      )}
    </div>
  );
}
