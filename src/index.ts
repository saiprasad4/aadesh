/**
 * aadesh... model the Indian recurring-payment mandate lifecycle.
 *
 * eNACH / e-mandate + UPI Autopay, in one typed, zero-dependency vocabulary:
 *  - normalize raw bank/NPCI/PSP error codes to consistent, conservative handling
 *  - drive the mandate and single-debit state machines
 *  - decide retries under the RBI/NPCI rules (attempt caps, spacing, safety)
 *
 * @packageDocumentation
 */

// ── Errors ───────────────────────────────────────────────────────────────────
export { AadeshError, InvalidTransitionError, AmbiguousCodeError } from './errors';

// ── Core types ───────────────────────────────────────────────────────────────
export type {
  Rail,
  MandateLayer,
  ErrorCategory,
  CategoryHandling,
  RawErrorCode,
  MandateErrorCode,
} from './types';

// ── Rails ────────────────────────────────────────────────────────────────────
export { getRailProfile, railProfiles } from './rails';
export type { RailProfile } from './rails';

// ── State machines ───────────────────────────────────────────────────────────
export { StateMachine, MandateMachine, DebitMachine } from './state/machine';
export {
  MANDATE_TRANSITIONS,
  DEBIT_TRANSITIONS,
  TERMINAL_MANDATE_STATES,
  TERMINAL_DEBIT_STATES,
} from './state/states';
export type { MandateState, DebitState } from './state/states';

// ── Error-code dictionary ────────────────────────────────────────────────────
export {
  getErrorCode,
  handlingFor,
  isRetriable,
  isTerminal,
  allErrorCodes,
  errorCodeCount,
  CATEGORY_HANDLING,
  DATASET_META,
} from './codes';
export type { LookupOptions } from './codes';

// ── Retry policy ─────────────────────────────────────────────────────────────
export { decideRetry } from './retry/policy';
export type { RetryContext, RetryDecision } from './retry/policy';

// ── Reconciliation ───────────────────────────────────────────────────────────
export { reconcile, RECONCILIATION_HANDLING, reconciliationHandlingFor } from './reconcile';
export type {
  DebitAttempt,
  DebitOutcome,
  ReconcileInput,
  ReconciledAttempt,
  ReconciledDebit,
  ReconciliationHandling,
  ReconciliationReport,
  ReconciliationStatus,
} from './reconcile';

// ── Compliance (AFA limits, pre-debit notification, schedule) ──────────────────
export {
  checkDebitLimits,
  planPreDebitNotification,
  isPreDebitNotificationTimely,
  PRE_DEBIT_NOTIFICATION_FIELDS,
  debitSchedule,
  upcomingDebits,
} from './compliance';
export type {
  DebitLimitInput,
  DebitLimitCheck,
  DebitLimitFlag,
  PreDebitNotificationInput,
  PreDebitNotificationPlan,
  PreDebitNotificationTimelinessInput,
  NotificationExemptCategory,
  MandateTerms,
  DateWindow,
  DebitFrequency,
  UpcomingDebit,
} from './compliance';

// ── PSP webhook adapters (Razorpay, Cashfree) ──────────────────────────────────
export { normalizeRazorpayWebhook, normalizeCashfreeWebhook } from './webhooks';
export type {
  WebhookProvider,
  NormalizedEventKind,
  EventScope,
  MandateWebhookEvent,
} from './webhooks';
