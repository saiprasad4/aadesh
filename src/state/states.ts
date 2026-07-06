/**
 * The two intertwined state machines of a recurring mandate:
 *
 *  1. {@link MandateState}... the *registration* lifecycle of the mandate itself.
 *  2. {@link DebitState}... the lifecycle of a *single debit attempt* against an
 *     active mandate.
 *
 * Transition tables are exported so callers can reason about, visualize, or
 * validate flows without instantiating a machine.
 */

// ── Mandate registration lifecycle ───────────────────────────────────────────

export type MandateState =
  | 'created'
  | 'pending_authentication'
  | 'pending_registration'
  | 'active'
  | 'rejected'
  | 'paused'
  | 'revoked'
  | 'expired'
  | 'completed';

/** Legal forward transitions for the mandate registration lifecycle. */
export const MANDATE_TRANSITIONS: Record<MandateState, readonly MandateState[]> = {
  created: ['pending_authentication', 'pending_registration', 'rejected'],
  pending_authentication: ['pending_registration', 'rejected', 'revoked'],
  pending_registration: ['active', 'rejected'],
  active: ['paused', 'revoked', 'expired', 'completed'],
  paused: ['active', 'revoked', 'expired', 'completed'],
  rejected: [],
  revoked: [],
  expired: [],
  completed: [],
};

/** States from which a mandate can no longer transition. */
export const TERMINAL_MANDATE_STATES: readonly MandateState[] = [
  'rejected',
  'revoked',
  'expired',
  'completed',
];

// ── Single-debit lifecycle ───────────────────────────────────────────────────

export type DebitState =
  | 'scheduled'
  | 'notified'
  | 'executing'
  | 'succeeded'
  | 'failed'
  | 'retry_scheduled'
  | 'exhausted';

/**
 * Legal forward transitions for one debit attempt.
 *
 * A debit must pass through `notified` before `executing`... the 24h pre-debit
 * notification is regulatorily mandatory, so the table does not allow
 * `scheduled → executing` to bypass it. A `failed` debit either reschedules
 * (`retry_scheduled`, which must be re-notified) or, when retries are exhausted,
 * ends in the terminal `exhausted` state.
 */
export const DEBIT_TRANSITIONS: Record<DebitState, readonly DebitState[]> = {
  scheduled: ['notified', 'failed'],
  notified: ['executing', 'failed'],
  executing: ['succeeded', 'failed'],
  failed: ['retry_scheduled', 'exhausted'],
  retry_scheduled: ['notified'],
  succeeded: [],
  exhausted: [],
};

/** States from which a debit attempt can no longer transition. */
export const TERMINAL_DEBIT_STATES: readonly DebitState[] = ['succeeded', 'exhausted'];
