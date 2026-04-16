import styles from './BillingComponents.module.css';

const PLANS: { id: string; label: string; price: string; blurb: string }[] = [
  { id: 'hobby', label: 'Hobby', price: '$9/mo', blurb: 'Solid limits for side projects' },
  { id: 'pro', label: 'Pro', price: '$49/mo', blurb: 'Production workloads' },
  { id: 'team', label: 'Team', price: '$199/mo', blurb: 'Dedicated infra & SLA' },
];

export interface ChangePlanModalProps {
  open: boolean;
  currentPlan: string;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (target: string) => void;
}

export function ChangePlanModal({ open, currentPlan, loading, error, onClose, onConfirm }: ChangePlanModalProps) {
  if (!open) return null;

  const cur = currentPlan.toLowerCase();

  return (
    <div className={styles.modalBackdrop} role="presentation" onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-plan-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="change-plan-title" className={styles.modalTitle}>
          Change plan
        </h2>
        <p className={styles.modalBody}>
          Your current subscription will end at the next billing date, then you&apos;ll check out on the new plan.
          Existing resources keep their current tier until then.
        </p>
        <div className={styles.planPickGrid}>
          {PLANS.map((p) => (
            <div key={p.id} className={`${styles.planPick} ${p.id === cur ? styles.planPickCurrent : ''}`}>
              <div className={styles.planPickHeader}>
                <strong>{p.label}</strong>
                <span>{p.price}</span>
              </div>
              <p className={styles.planPickBlurb}>{p.blurb}</p>
              {p.id !== cur && (
                <button
                  type="button"
                  className={styles.btnPrimary}
                  disabled={loading}
                  onClick={() => onConfirm(p.id)}
                  data-testid={`change-plan-select-${p.id}`}
                >
                  Switch to {p.label}
                </button>
              )}
              {p.id === cur && <span className={styles.currentPill}>Current</span>}
            </div>
          ))}
        </div>
        {error && (
          <p className={styles.errorText} role="alert">
            {error}
          </p>
        )}
        <button type="button" className={styles.btnGhost} onClick={onClose} disabled={loading}>
          Close
        </button>
      </div>
    </div>
  );
}
