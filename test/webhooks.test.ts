import { describe, expect, it } from 'vitest';
import { normalizeCashfreeWebhook, normalizeRazorpayWebhook } from '../src/index';

/**
 * PSP webhook normalization. Verified against the Razorpay Subscriptions and
 * Cashfree Subscriptions (v1) webhook docs. The two providers name events
 * differently and carry amounts in different units (Razorpay paise, Cashfree
 * rupees); both collapse to one event shape with integer-paise amounts.
 */

function razorpay(event: string, extra: Record<string, unknown> = {}) {
  return {
    entity: 'event',
    account_id: 'acc_1',
    event,
    created_at: 1_773_000_000,
    payload: {
      subscription: { entity: { id: 'sub_ABC', status: 'active' } },
      payment: { entity: { id: 'pay_XYZ', amount: 100_000, currency: 'INR', method: 'upi', ...extra } },
    },
  };
}

describe('normalizeRazorpayWebhook', () => {
  it('maps a successful charge to debit.succeeded with paise unchanged', () => {
    const event = normalizeRazorpayWebhook(razorpay('subscription.charged'));
    expect(event.kind).toBe('debit.succeeded');
    expect(event.scope).toBe('debit');
    expect(event.debitState).toBe('succeeded');
    expect(event.mandateRef).toBe('sub_ABC');
    expect(event.debitRef).toBe('pay_XYZ');
    expect(event.amountPaise).toBe(100_000);
    expect(event.rail).toBe('upi_autopay');
    expect(event.occurredAt?.toISOString()).toBe('2026-03-08T20:00:00.000Z');
  });

  it('maps mandate lifecycle events to mandate states', () => {
    expect(normalizeRazorpayWebhook(razorpay('subscription.authenticated'))).toMatchObject({
      kind: 'mandate.authenticated',
      scope: 'mandate',
      mandateState: 'pending_registration',
    });
    expect(normalizeRazorpayWebhook(razorpay('subscription.activated'))).toMatchObject({
      kind: 'mandate.activated',
      mandateState: 'active',
    });
    expect(normalizeRazorpayWebhook(razorpay('subscription.cancelled'))).toMatchObject({
      kind: 'mandate.cancelled',
      mandateState: 'revoked',
    });
  });

  it('maps a failed charge to debit.failed and an exhausted one to debit.exhausted', () => {
    const pending = normalizeRazorpayWebhook(razorpay('subscription.pending', { error_code: 'IE' }));
    expect(pending.kind).toBe('debit.failed');
    expect(pending.debitState).toBe('failed');
    expect(pending.rawErrorCode).toBe('IE');
    expect(pending.errorCode?.category).toBe('insufficient_funds'); // resolved via the code dataset, rail from method

    expect(normalizeRazorpayWebhook(razorpay('subscription.halted')).kind).toBe('debit.exhausted');
  });

  it('reads the rail from the payment method', () => {
    expect(normalizeRazorpayWebhook(razorpay('subscription.charged', { method: 'emandate' })).rail).toBe(
      'enach',
    );
  });

  it('returns unknown for an unmodelled event without throwing', () => {
    const event = normalizeRazorpayWebhook({ event: 'subscription.some_new_thing', payload: {} });
    expect(event.kind).toBe('unknown');
    expect(event.scope).toBe('unknown');
    expect(event.providerEvent).toBe('subscription.some_new_thing');
  });

  it('tolerates a malformed payload', () => {
    expect(normalizeRazorpayWebhook(null).kind).toBe('unknown');
    expect(normalizeRazorpayWebhook('nope').providerEvent).toBe('');
  });
});

describe('normalizeCashfreeWebhook', () => {
  it('converts a rupee charge amount to integer paise', () => {
    const event = normalizeCashfreeWebhook({
      cf_event: 'SUBSCRIPTION_NEW_PAYMENT',
      cf_subReferenceId: 987_654,
      cf_subscriptionId: 'merchant-sub-1',
      cf_paymentId: 111_222,
      cf_amount: 1000.5, // rupees
      cf_eventTime: '2026-03-15 10:00:00',
    });
    expect(event.kind).toBe('debit.succeeded');
    expect(event.amountPaise).toBe(100_050);
    expect(event.mandateRef).toBe('merchant-sub-1');
    expect(event.debitRef).toBe('111222');
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  it('maps a declined payment and keeps the raw reason', () => {
    const event = normalizeCashfreeWebhook({
      cf_event: 'SUBSCRIPTION_PAYMENT_DECLINED',
      cf_subscriptionId: 's1',
      cf_paymentId: 5,
      cf_amount: 500,
      cf_reasons: 'Insufficient funds in account',
    });
    expect(event.kind).toBe('debit.failed');
    expect(event.debitState).toBe('failed');
    expect(event.rawErrorCode).toBe('Insufficient funds in account');
  });

  it('maps subscription status changes to mandate states', () => {
    const active = normalizeCashfreeWebhook({ cf_event: 'SUBSCRIPTION_STATUS_CHANGE', cf_status: 'ACTIVE' });
    expect(active).toMatchObject({ kind: 'mandate.activated', mandateState: 'active' });

    const cancelled = normalizeCashfreeWebhook({
      cf_event: 'SUBSCRIPTION_STATUS_CHANGE',
      cf_status: 'CANCELLED',
    });
    expect(cancelled).toMatchObject({ kind: 'mandate.cancelled', mandateState: 'revoked' });

    const pending = normalizeCashfreeWebhook({
      cf_event: 'SUBSCRIPTION_STATUS_CHANGE',
      cf_status: 'BANK_APPROVAL_PENDING',
    });
    expect(pending).toMatchObject({ kind: 'mandate.updated', mandateState: 'pending_registration' });
  });

  it('maps auth status success and failure', () => {
    const ok = normalizeCashfreeWebhook({ cf_event: 'SUBSCRIPTION_AUTH_STATUS', cf_authStatus: 'SUCCESS' });
    expect(ok).toMatchObject({ kind: 'mandate.authenticated', mandateState: 'pending_registration' });

    const failed = normalizeCashfreeWebhook({
      cf_event: 'SUBSCRIPTION_AUTH_STATUS',
      cf_authStatus: 'FAILED',
      cf_authFailureReason: 'User cancelled at bank page',
    });
    expect(failed).toMatchObject({ kind: 'mandate.rejected', mandateState: 'rejected' });
    expect(failed.rawErrorCode).toBe('User cancelled at bank page');
  });

  it('maps refund and cancelled-payment events to refund scope', () => {
    expect(normalizeCashfreeWebhook({ cf_event: 'PAYMENT_CANCELLED_WEBHOOK' }).scope).toBe('refund');

    const refund = normalizeCashfreeWebhook({
      cf_event: 'REFUND_STATUS_WEBHOOK',
      cf_payment_id: 42,
      cf_refund_amount: 250.0,
    });
    expect(refund.kind).toBe('refund');
    expect(refund.amountPaise).toBe(25_000);
    expect(refund.debitRef).toBe('42');
  });

  it('returns unknown for an unmodelled event', () => {
    expect(normalizeCashfreeWebhook({ cf_event: 'SOME_FUTURE_EVENT' }).kind).toBe('unknown');
  });
});

describe('cross-provider amount normalization', () => {
  it('reports the same paise for a ₹1000 charge from either provider', () => {
    const razor = normalizeRazorpayWebhook(razorpay('subscription.charged')); // 100000 paise
    const cash = normalizeCashfreeWebhook({ cf_event: 'SUBSCRIPTION_NEW_PAYMENT', cf_amount: 1000 }); // ₹1000
    expect(razor.amountPaise).toBe(cash.amountPaise);
    expect(cash.amountPaise).toBe(100_000);
  });
});
