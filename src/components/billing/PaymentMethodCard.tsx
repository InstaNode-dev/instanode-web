import styles from './BillingComponents.module.css';

export interface PaymentMethodCardProps {
  last4?: string;
  network?: string;
  expMonth?: number;
  expYear?: number;
  razorpayConfigured: boolean;
  onUpdate: () => void;
  disabled?: boolean;
}

export function PaymentMethodCard({
  last4,
  network,
  expMonth,
  expYear,
  razorpayConfigured,
  onUpdate,
  disabled,
}: PaymentMethodCardProps) {
  const hasCard = Boolean(last4);
  const exp =
    expMonth && expYear
      ? `${String(expMonth).padStart(2, '0')}/${String(expYear).slice(-2)}`
      : null;

  return (
    <div className={styles.card}>
      <p className={styles.cardTitle}>Payment method</p>
      {hasCard ? (
        <div className={styles.paymentRow} data-testid="billing-payment-method">
          <span className={styles.cardBrand}>{network || 'Card'}</span>
          <span>
            •••• {last4}
            {exp && <span className={styles.exp}> · Expires {exp}</span>}
          </span>
        </div>
      ) : (
        <p className={styles.muted}>No card on file yet — complete checkout to add a payment method.</p>
      )}
      {razorpayConfigured && (
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={onUpdate}
          disabled={disabled}
          data-testid="billing-update-payment"
        >
          Update payment method
        </button>
      )}
    </div>
  );
}
