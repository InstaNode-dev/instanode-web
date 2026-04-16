import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useRequireAuth } from '../hooks/useAuth';
import {
  fetchBilling,
  listInvoices,
  cancelSubscription,
  updatePaymentMethod,
  changePlan,
} from '../api/billing';
import { fetchResources } from '../api/resources';
import type { ResourceType } from '../types/resource';
import { PlanCard } from '../components/billing/PlanCard';
import { PaymentMethodCard } from '../components/billing/PaymentMethodCard';
import { InvoiceList } from '../components/billing/InvoiceList';
import { ChangePlanModal } from '../components/billing/ChangePlanModal';
import { CancelPlanModal } from '../components/billing/CancelPlanModal';
import styles from './BillingPage.module.css';

const RESOURCE_TYPES: { type: ResourceType; label: string }[] = [
  { type: 'postgres', label: 'Postgres' },
  { type: 'redis', label: 'Redis' },
  { type: 'mongodb', label: 'MongoDB' },
  { type: 'queue', label: 'Queue' },
  { type: 'webhook', label: 'Webhook' },
  { type: 'storage', label: 'Storage' },
];

export function BillingPage() {
  const { isLoading: authLoading } = useRequireAuth();
  const queryClient = useQueryClient();
  const [changeOpen, setChangeOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    data: billingData,
    isLoading: billingLoading,
    error: billingError,
    refetch: refetchBilling,
  } = useQuery({
    queryKey: ['billing-status'],
    queryFn: fetchBilling,
    enabled: !authLoading,
  });

  const {
    data: resourcesData,
    isLoading: resourcesLoading,
    error: resourcesError,
    refetch: refetchResources,
  } = useQuery({
    queryKey: ['resources'],
    queryFn: fetchResources,
    enabled: !authLoading,
  });

  const { data: invoiceData, isLoading: invoicesLoading } = useQuery({
    queryKey: ['billing-invoices'],
    queryFn: listInvoices,
    enabled: !authLoading && Boolean(billingData?.billing.razorpay_configured),
  });

  const cancelMut = useMutation({
    mutationFn: cancelSubscription,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['billing-status'] });
      setCancelOpen(false);
      setActionError(null);
    },
  });

  const payMut = useMutation({
    mutationFn: updatePaymentMethod,
    onSuccess: (res) => {
      if (res.short_url) {
        window.location.href = res.short_url;
      }
    },
    onError: (e: Error) => {
      setActionError(e.message);
    },
  });

  const changeMut = useMutation({
    mutationFn: changePlan,
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['billing-status'] });
      void queryClient.invalidateQueries({ queryKey: ['billing-invoices'] });
      setChangeOpen(false);
      setActionError(null);
      if (res.short_url) {
        window.location.href = res.short_url;
      }
    },
  });

  if (authLoading) {
    return (
      <div className={styles.center} aria-live="polite">
        Authenticating…
      </div>
    );
  }

  const isLoading = billingLoading || resourcesLoading || invoicesLoading;
  const error = billingError ?? resourcesError;

  if (isLoading) {
    return (
      <div className={styles.center} aria-live="polite" data-testid="billing-loading">
        Loading billing…
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.errorState} role="alert" data-testid="billing-error">
        <p>Failed to load billing information: {(error as Error).message}</p>
        <button
          className={styles.retryBtn}
          type="button"
          onClick={() => {
            void refetchBilling();
            void refetchResources();
            void queryClient.invalidateQueries({ queryKey: ['billing-invoices'] });
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  const planTier = billingData?.plan ?? 'hobby';
  const b = billingData?.billing;
  const resources = resourcesData?.items ?? [];
  const invoices = invoiceData?.invoices ?? [];

  const countByType = (type: ResourceType): number =>
    resources.filter((r) => r.resource_type === type && r.status === 'active').length;

  const showUpgradeCta = planTier === 'hobby' || planTier === 'anonymous';
  const paidTier = planTier === 'pro' || planTier === 'team' || planTier === 'hobby';
  const st = (b?.status ?? 'none').toLowerCase();
  const showManage =
    paidTier &&
    st !== 'none' &&
    st !== 'cancelled' &&
    st !== 'canceled' &&
    st !== 'completed' &&
    st !== 'expired';

  return (
    <div className={styles.page} data-testid="billing-page">
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Billing</h1>
        <p className={styles.subtitle}>
          Manage your plan, payment method, and invoices.{' '}
          <Link to="/settings?section=billing" className={styles.inlineLink}>
            Settings
          </Link>
        </p>
      </div>

      {actionError && (
        <div className={styles.bannerError} role="alert">
          {actionError}
        </div>
      )}

      <div className={styles.grid}>
        <PlanCard
          plan={planTier}
          billingStatus={b?.status ?? 'none'}
          subscriptionStatus={b?.subscription_status}
          currentPeriodEnd={b?.current_period_end ?? null}
          cancelAtPeriodEnd={b?.cancel_at_period_end}
          razorpayConfigured={Boolean(b?.razorpay_configured)}
          onChangePlan={() => {
            setActionError(null);
            setChangeOpen(true);
          }}
          onCancel={() => {
            setActionError(null);
            setCancelOpen(true);
          }}
          showManage={Boolean(showManage)}
        />

        <div className={styles.card}>
          <p className={styles.cardTitle}>Resources in use</p>
          <div className={styles.resourceSummary}>
            {RESOURCE_TYPES.map(({ type, label }) => (
              <div key={type} className={styles.resourceStat}>
                <span className={styles.resourceStatLabel}>{label}</span>
                <span className={styles.resourceStatCount}>{countByType(type)}</span>
              </div>
            ))}
          </div>
        </div>

        <PaymentMethodCard
          last4={b?.payment_last4}
          network={b?.payment_network}
          expMonth={b?.payment_exp_month}
          expYear={b?.payment_exp_year}
          razorpayConfigured={Boolean(b?.razorpay_configured)}
          onUpdate={() => {
            setActionError(null);
            payMut.mutate();
          }}
          disabled={payMut.isPending}
        />

        <InvoiceList invoices={invoices} />

        {showUpgradeCta && (
          <div className={styles.upgradeCard}>
            <p className={styles.upgradeTitle}>Upgrade</p>
            <p className={styles.upgradeBody}>
              Larger databases, higher limits, and priority support. Start from the pricing page or checkout in
              settings.
            </p>
            <Link to="/pricing" className={styles.upgradeCta} data-testid="billing-upgrade-cta">
              View pricing
            </Link>
          </div>
        )}
      </div>

      <ChangePlanModal
        open={changeOpen}
        currentPlan={planTier}
        loading={changeMut.isPending}
        error={changeMut.error ? (changeMut.error as Error).message : null}
        onClose={() => {
          setChangeOpen(false);
          changeMut.reset();
        }}
        onConfirm={(target) => changeMut.mutate(target)}
      />

      <CancelPlanModal
        open={cancelOpen}
        loading={cancelMut.isPending}
        error={cancelMut.error ? (cancelMut.error as Error).message : null}
        onClose={() => {
          setCancelOpen(false);
          cancelMut.reset();
        }}
        onConfirm={() => cancelMut.mutate()}
      />
    </div>
  );
}
