import styles from './BillingComponents.module.css';

export interface CancelPlanModalProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function CancelPlanModal({ open, loading, error, onClose, onConfirm }: CancelPlanModalProps) {
  if (!open) return null;

  return (
    <div className={styles.modalBackdrop} role="presentation" onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-plan-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="cancel-plan-title" className={styles.modalTitle}>
          Cancel subscription
        </h2>
        <p className={styles.modalBody}>
          Your paid plan will stay active until the end of this billing period. After that, your team moves to a
          lower tier. <strong>Existing resources keep their current tier</strong> (snapshot at creation) — new
          provisions follow the new plan limits.
        </p>
        {error && (
          <p className={styles.errorText} role="alert">
            {error}
          </p>
        )}
        <div className={styles.modalActions}>
          <button type="button" className={styles.btnGhost} onClick={onClose} disabled={loading}>
            Keep plan
          </button>
          <button type="button" className={styles.btnDanger} onClick={onConfirm} disabled={loading} data-testid="cancel-plan-confirm">
            {loading ? 'Cancelling…' : 'Cancel at period end'}
          </button>
        </div>
      </div>
    </div>
  );
}
