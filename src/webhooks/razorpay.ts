import type { DebitState, MandateState } from '../state/states';
import type { Rail } from '../types';
import { asObject, paiseFromInteger, readNumber, readString, resolveErrorCode } from './shared';
import type { EventScope, MandateWebhookEvent, NormalizedEventKind } from './types';

/**
 * Normalize a Razorpay Subscriptions webhook.
 *
 * Verified against Razorpay's subscription webhook docs: 10 `subscription.*`
 * events, the payload carries `payload.subscription.entity` and, when a charge was
 * attempted, `payload.payment.entity`. Amounts are integer paise. A failed charge
 * arrives as `subscription.pending`; after all retries are exhausted, as
 * `subscription.halted`.
 */

interface RazorpayMapping {
  readonly kind: NormalizedEventKind;
  readonly scope: EventScope;
  readonly mandateState?: MandateState;
  readonly debitState?: DebitState;
}

const RAZORPAY_EVENTS: Record<string, RazorpayMapping> = {
  'subscription.authenticated': {
    kind: 'mandate.authenticated',
    scope: 'mandate',
    mandateState: 'pending_registration',
  },
  'subscription.activated': { kind: 'mandate.activated', scope: 'mandate', mandateState: 'active' },
  'subscription.charged': { kind: 'debit.succeeded', scope: 'debit', debitState: 'succeeded' },
  'subscription.completed': { kind: 'mandate.completed', scope: 'mandate', mandateState: 'completed' },
  'subscription.updated': { kind: 'mandate.updated', scope: 'mandate', mandateState: 'active' },
  'subscription.pending': { kind: 'debit.failed', scope: 'debit', debitState: 'failed' },
  'subscription.halted': { kind: 'debit.exhausted', scope: 'debit', debitState: 'exhausted' },
  'subscription.paused': { kind: 'mandate.paused', scope: 'mandate', mandateState: 'paused' },
  'subscription.resumed': { kind: 'mandate.resumed', scope: 'mandate', mandateState: 'active' },
  'subscription.cancelled': { kind: 'mandate.cancelled', scope: 'mandate', mandateState: 'revoked' },
};

/** Razorpay reports the instrument on the payment entity; map it to a rail when clear. */
function railFromMethod(method: string | undefined): Rail | undefined {
  if (method === 'emandate' || method === 'nach') {
    return 'enach';
  }
  if (method === 'upi') {
    return 'upi_autopay';
  }
  return undefined;
}

export function normalizeRazorpayWebhook(payload: unknown): MandateWebhookEvent {
  const root = asObject(payload);
  const providerEvent = readString(root, 'event') ?? '';
  const mapping = RAZORPAY_EVENTS[providerEvent];

  const container = asObject(root?.payload);
  const subscription = asObject(asObject(container?.subscription)?.entity);
  const payment = asObject(asObject(container?.payment)?.entity);

  const createdAt = readNumber(root, 'created_at');
  const rail = railFromMethod(readString(payment, 'method'));
  const rawErrorCode = readString(payment, 'error_code');

  return {
    provider: 'razorpay',
    kind: mapping?.kind ?? 'unknown',
    scope: mapping?.scope ?? 'unknown',
    mandateState: mapping?.mandateState,
    debitState: mapping?.debitState,
    rail,
    mandateRef: readString(subscription, 'id'),
    debitRef: readString(payment, 'id'),
    amountPaise: paiseFromInteger(readNumber(payment, 'amount')),
    occurredAt: createdAt !== undefined ? new Date(createdAt * 1000) : undefined,
    providerEvent,
    rawErrorCode,
    errorCode: resolveErrorCode(rawErrorCode, rail),
    raw: payload,
  };
}
