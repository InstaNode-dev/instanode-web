import { apiFetch } from './client';

export interface BillingDetails {
  status: string;
  current_period_end: string | null;
  razorpay_configured: boolean;
  subscription_status?: string;
  payment_last4?: string;
  payment_network?: string;
  payment_exp_month?: number;
  payment_exp_year?: number;
  cancel_at_period_end?: boolean;
}

export interface BillingResponse {
  ok: boolean;
  plan: string;
  billing: BillingDetails;
}

export async function fetchBilling(): Promise<BillingResponse> {
  return apiFetch<BillingResponse>('/api/v1/billing');
}

export interface CheckoutResponse {
  ok: boolean;
  short_url: string;
  subscription_id?: string;
}

export async function createCheckout(plan: string): Promise<CheckoutResponse> {
  return apiFetch<CheckoutResponse>('/api/v1/billing/checkout', {
    method: 'POST',
    body: { plan },
  });
}

export interface CancelSubscriptionResponse {
  ok: boolean;
  cancelled_at_cycle_end: boolean;
}

export async function cancelSubscription(): Promise<CancelSubscriptionResponse> {
  return apiFetch<CancelSubscriptionResponse>('/api/v1/billing/cancel', {
    method: 'POST',
    body: {},
  });
}

export interface InvoiceRow {
  id: string;
  amount: number;
  currency: string;
  status: string;
  date: string;
  pdf_url: string;
}

export interface ListInvoicesResponse {
  ok: boolean;
  invoices: InvoiceRow[];
}

export async function listInvoices(): Promise<ListInvoicesResponse> {
  return apiFetch<ListInvoicesResponse>('/api/v1/billing/invoices');
}

export interface UpdatePaymentResponse {
  ok: boolean;
  short_url: string;
}

export async function updatePaymentMethod(): Promise<UpdatePaymentResponse> {
  return apiFetch<UpdatePaymentResponse>('/api/v1/billing/update-payment', {
    method: 'POST',
    body: {},
  });
}

export interface ChangePlanResponse {
  ok: boolean;
  new_plan: string;
  effective_date: string;
  short_url: string;
}

export async function changePlan(targetPlan: string): Promise<ChangePlanResponse> {
  return apiFetch<ChangePlanResponse>('/api/v1/billing/change-plan', {
    method: 'POST',
    body: { target_plan: targetPlan },
  });
}
