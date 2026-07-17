import type { MandateState } from '../state/states';
import { asObject, paiseFromRupees, readNumber, readString, resolveErrorCode } from './shared';
import type { MandateWebhookEvent, NormalizedEventKind } from './types';

/**
 * Normalize a Cashfree Subscriptions (v1) webhook.
 *
 * Verified against Cashfree's subscriptions v1 webhook docs. Two things to watch,
 * both handled here: amounts are rupees (a float), not paise, so they are
 * converted; and the `cf_event` value does not always match the event's name (a
 * cancelled payment arrives as `PAYMENT_CANCELLED_WEBHOOK`, a refund as
 * `REFUND_STATUS_WEBHOOK`), so mapping is keyed on the actual `cf_event` string.
 */

interface PaymentMapping {
  readonly kind: NormalizedEventKind;
  readonly scope: 'debit' | 'refund';
  readonly debitState?: 'succeeded' | 'failed';
}

const CASHFREE_PAYMENT_EVENTS: Record<string, PaymentMapping> = {
  SUBSCRIPTION_NEW_PAYMENT: { kind: 'debit.succeeded', scope: 'debit', debitState: 'succeeded' },
  SUBSCRIPTION_PAYMENT_DECLINED: { kind: 'debit.failed', scope: 'debit', debitState: 'failed' },
  PAYMENT_CANCELLED_WEBHOOK: { kind: 'refund', scope: 'refund' },
  REFUND_STATUS_WEBHOOK: { kind: 'refund', scope: 'refund' },
};

const CASHFREE_STATUS: Record<string, { kind: NormalizedEventKind; mandateState: MandateState }> = {
  INITIALIZED: { kind: 'mandate.updated', mandateState: 'created' },
  BANK_APPROVAL_PENDING: { kind: 'mandate.updated', mandateState: 'pending_registration' },
  ACTIVE: { kind: 'mandate.activated', mandateState: 'active' },
  ON_HOLD: { kind: 'mandate.paused', mandateState: 'paused' },
  PAUSED: { kind: 'mandate.paused', mandateState: 'paused' },
  CANCELLED: { kind: 'mandate.cancelled', mandateState: 'revoked' },
  COMPLETED: { kind: 'mandate.completed', mandateState: 'completed' },
};

function mandateRefOf(root: Record<string, unknown> | undefined): string | undefined {
  return (
    readString(root, 'cf_subscriptionId') ??
    readString(root, 'subscriptionId') ??
    readString(root, 'cf_subReferenceId')
  );
}

function debitRefOf(root: Record<string, unknown> | undefined): string | undefined {
  return (
    readString(root, 'cf_paymentId') ?? readString(root, 'paymentId') ?? readString(root, 'cf_payment_id')
  );
}

function amountPaiseOf(root: Record<string, unknown> | undefined): number | undefined {
  const rupees =
    readNumber(root, 'cf_amount') ?? readNumber(root, 'amount') ?? readNumber(root, 'cf_refund_amount');
  return paiseFromRupees(rupees);
}

function occurredAtOf(root: Record<string, unknown> | undefined): Date | undefined {
  const stamp = readString(root, 'cf_eventTime') ?? readString(root, 'cf_authTimestamp');
  if (!stamp) {
    return undefined;
  }
  const parsed = new Date(stamp.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function normalizeCashfreeWebhook(payload: unknown): MandateWebhookEvent {
  const root = asObject(payload);
  const providerEvent = readString(root, 'cf_event') ?? '';

  const base = {
    provider: 'cashfree' as const,
    mandateRef: mandateRefOf(root),
    debitRef: debitRefOf(root),
    amountPaise: amountPaiseOf(root),
    occurredAt: occurredAtOf(root),
    providerEvent,
    raw: payload,
  };

  if (providerEvent === 'SUBSCRIPTION_STATUS_CHANGE') {
    const status = (readString(root, 'cf_status') ?? '').toUpperCase();
    const mapping = CASHFREE_STATUS[status];
    return {
      ...base,
      kind: mapping?.kind ?? 'unknown',
      scope: mapping ? 'mandate' : 'unknown',
      mandateState: mapping?.mandateState,
    };
  }

  if (providerEvent === 'SUBSCRIPTION_AUTH_STATUS') {
    const authenticated = (readString(root, 'cf_authStatus') ?? '').toUpperCase() === 'SUCCESS';
    const reason = readString(root, 'cf_authFailureReason');
    return {
      ...base,
      kind: authenticated ? 'mandate.authenticated' : 'mandate.rejected',
      scope: 'mandate',
      mandateState: authenticated ? 'pending_registration' : 'rejected',
      rawErrorCode: authenticated ? undefined : reason,
      errorCode: authenticated ? undefined : resolveErrorCode(reason, undefined),
    };
  }

  const mapping = CASHFREE_PAYMENT_EVENTS[providerEvent];
  const declineReason =
    mapping?.kind === 'debit.failed'
      ? (readString(root, 'cf_reasons') ?? readString(root, 'reasons'))
      : undefined;

  return {
    ...base,
    kind: mapping?.kind ?? 'unknown',
    scope: mapping?.scope ?? 'unknown',
    debitState: mapping?.debitState,
    rawErrorCode: declineReason,
    errorCode: resolveErrorCode(declineReason, undefined),
  };
}
