import type { DebitState, MandateState } from '../state/states';
import type { MandateErrorCode, Rail } from '../types';

/**
 * A PSP webhook, normalized into one aadesh lifecycle event.
 *
 * Every provider names its events differently and carries amounts in a different
 * unit (Razorpay in paise, Cashfree in rupees). This collapses them to a single
 * shape aligned with the mandate and debit state machines, so the same handler
 * works across providers. The original payload is kept on `raw` as an escape hatch.
 */

export type WebhookProvider = 'razorpay' | 'cashfree';

/**
 * The provider-neutral lifecycle signal a webhook carries. `unknown` is returned
 * for events aadesh does not model rather than throwing, so an unrecognized event
 * never breaks a handler.
 */
export type NormalizedEventKind =
  | 'mandate.authenticated'
  | 'mandate.activated'
  | 'mandate.updated'
  | 'mandate.paused'
  | 'mandate.resumed'
  | 'mandate.cancelled'
  | 'mandate.completed'
  | 'mandate.rejected'
  | 'debit.succeeded'
  | 'debit.failed'
  | 'debit.exhausted'
  | 'refund'
  | 'unknown';

export type EventScope = 'mandate' | 'debit' | 'refund' | 'unknown';

export interface MandateWebhookEvent {
  readonly provider: WebhookProvider;
  readonly kind: NormalizedEventKind;
  readonly scope: EventScope;
  /** The mandate state this event moves the mandate to, when it is a mandate event. */
  readonly mandateState?: MandateState;
  /** The debit state this event moves the debit to, when it is a debit event. */
  readonly debitState?: DebitState;
  /** The rail, when the payload makes it unambiguous (e.g. Razorpay payment method). */
  readonly rail?: Rail;
  /** The mandate identifier (subscription/token id). */
  readonly mandateRef?: string;
  /** The debit identifier (payment id), when the event concerns a debit. */
  readonly debitRef?: string;
  /** Amount in integer paise, normalized from whatever unit the provider used. */
  readonly amountPaise?: number;
  /** When the event occurred, best-effort from the provider's timestamp. */
  readonly occurredAt?: Date;
  /** The raw provider event string, exactly as received. */
  readonly providerEvent: string;
  /** The raw failure code/reason the provider gave, if any. */
  readonly rawErrorCode?: string;
  /** The resolved aadesh error handling, when the raw code is in the dataset. */
  readonly errorCode?: MandateErrorCode;
  /** The original payload. */
  readonly raw: unknown;
}
