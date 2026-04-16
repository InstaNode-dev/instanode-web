import type { InvoiceRow } from '../../api/billing';
import styles from './BillingComponents.module.css';

function formatMoney(amount: number, currency: string): string {
  const cur = (currency || 'USD').toUpperCase();
  const major = amount / 100;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(major);
  } catch {
    return `${cur} ${(major).toFixed(2)}`;
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export interface InvoiceListProps {
  invoices: InvoiceRow[];
}

export function InvoiceList({ invoices }: InvoiceListProps) {
  if (invoices.length === 0) {
    return (
      <div className={styles.card}>
        <p className={styles.cardTitle}>Invoices</p>
        <p className={styles.muted} data-testid="billing-invoices-empty">
          No invoices yet.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <p className={styles.cardTitle}>Invoices</p>
      <ul className={styles.invoiceList} data-testid="billing-invoice-list">
        {invoices.map((inv) => (
          <li key={inv.id} className={styles.invoiceRow}>
            <span className={styles.invoiceDate}>{formatDate(inv.date)}</span>
            <span className={styles.invoiceAmt}>{formatMoney(inv.amount, inv.currency)}</span>
            <span className={styles.invoiceStatus}>{inv.status}</span>
            {inv.pdf_url ? (
              <a href={inv.pdf_url} target="_blank" rel="noopener noreferrer" className={styles.invoiceLink}>
                View
              </a>
            ) : (
              <span className={styles.muted}>—</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
