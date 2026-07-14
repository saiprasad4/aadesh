import { getErrorCode } from '../codes';
import { AadeshError } from '../errors';
import { getRailProfile } from '../rails';
import type { ErrorCategory } from '../types';
import { RECONCILIATION_HANDLING } from './handling';
import type {
  DebitAttempt,
  DebitOutcome,
  ReconcileInput,
  ReconciledAttempt,
  ReconciledDebit,
  ReconciliationReport,
  ReconciliationStatus,
} from './types';

const HOUR_MS = 60 * 60 * 1000;

function assertMoney(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new AadeshError(`${label} must be a non-negative integer in paise; got ${value}`);
  }
}

function assertDate(value: unknown, label: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new AadeshError(`${label} must be a valid Date`);
  }
}

function categoryOf(outcome: DebitOutcome): ErrorCategory | undefined {
  return getErrorCode(outcome.rawCode, { rail: outcome.rail })?.category;
}

/** All outcomes attached to one attempt, plus the derived signals we classify on. */
interface AttemptState {
  readonly attempt: DebitAttempt;
  readonly outcomes: DebitOutcome[];
  hasSuccess: boolean;
  hasKnownFailure: boolean;
  hasUnknown: boolean;
  amountMismatch: boolean;
}

function representativeOutcome(state: AttemptState): DebitOutcome | undefined {
  if (state.outcomes.length === 0) return undefined;
  // Prefer a success (it is the money-relevant one), else the latest reported.
  const success = state.outcomes.find((o) => categoryOf(o) === 'success');
  if (success) return success;
  return [...state.outcomes].sort((a, b) => b.reportedAt.getTime() - a.reportedAt.getTime())[0];
}

function classify(
  states: AttemptState[],
  leftoverOutcomes: DebitOutcome[],
  leftoverAmountMismatch: boolean,
  now: Date,
  windowHours: number,
): { status: ReconciliationStatus; unsettled: DebitAttempt[] } {
  const successAttemptIds = new Set(states.filter((s) => s.hasSuccess).map((s) => s.attempt.attemptId));
  const leftoverSuccesses = leftoverOutcomes.filter((o) => categoryOf(o) === 'success').length;
  const totalSuccessSignals = successAttemptIds.size + leftoverSuccesses;

  const unsettled = states.filter((s) => s.outcomes.length === 0).map((s) => s.attempt);
  const unsettledExists = unsettled.length > 0;

  const hasUnknown =
    states.some((s) => s.hasUnknown) || leftoverOutcomes.some((o) => categoryOf(o) === undefined);
  const amountMismatch = states.some((s) => s.amountMismatch) || leftoverAmountMismatch;

  // An attempt that reports both a success and a failure is internally contradictory.
  const selfContradiction = states.some((s) => s.hasSuccess && s.hasKnownFailure);

  let status: ReconciliationStatus;
  if (successAttemptIds.size >= 2) {
    status = 'double_debit_confirmed';
  } else if (totalSuccessSignals >= 2) {
    // One provable success plus another success we cannot attribute to a distinct
    // attempt: could be a duplicate report or a second settlement. Do not auto-reverse.
    status = 'ambiguous';
  } else if (selfContradiction) {
    status = 'ambiguous';
  } else if (amountMismatch) {
    status = 'amount_mismatch';
  } else if (totalSuccessSignals === 1) {
    if (unsettledExists) status = 'double_debit_risk';
    else if (hasUnknown) status = 'ambiguous';
    else status = 'settled';
  } else {
    // No successes at all.
    if (hasUnknown) {
      status = 'ambiguous';
    } else if (unsettledExists) {
      const overdue = unsettled.some((a) => a.presentedAt.getTime() + windowHours * HOUR_MS <= now.getTime());
      status = overdue ? 'timed_out' : 'pending';
    } else {
      status = 'failed';
    }
  }

  return { status, unsettled };
}

function explain(status: ReconciliationStatus, debitKey: string, attemptCount: number): string {
  switch (status) {
    case 'double_debit_confirmed':
      return `${debitKey}: two attempts settled; a reversal is owed.`;
    case 'double_debit_risk':
      return `${debitKey}: a success landed while another attempt is still open; suppress the retry.`;
    case 'amount_mismatch':
      return `${debitKey}: a reported amount does not match the amount presented.`;
    case 'settled':
      return `${debitKey}: settled on one successful attempt.`;
    case 'failed':
      return `${debitKey}: all ${attemptCount} attempt(s) failed; no money moved.`;
    case 'pending':
      return `${debitKey}: awaiting an outcome, still within the return window.`;
    case 'timed_out':
      return `${debitKey}: no outcome past the return window; probe status before retrying.`;
    default:
      return `${debitKey}: could not be classified safely; hold for review.`;
  }
}

/**
 * Reconcile the debits you presented against the outcomes the bank/PSP reported.
 *
 * Attempts are grouped by {@link DebitAttempt.debitKey} into logical debits, and
 * each logical debit is classified conservatively (see {@link ReconciliationStatus}).
 * Outcomes carrying an `attemptId` pair exactly; outcomes carrying only a
 * `debitKey` are attributed to that debit's unsettled attempts in presentation
 * order. Anything that cannot be proven settled leans toward `suppressRetry` and
 * `needsReview` rather than guessing with money.
 *
 * Pure and deterministic: given the same inputs and clock, the report is identical.
 * Throws {@link AadeshError} on malformed input (non-integer/negative paise, an
 * outcome with neither `attemptId` nor `debitKey`, invalid dates).
 */
export function reconcile(input: ReconcileInput): ReconciliationReport {
  const now = input.now ?? new Date();
  assertDate(now, 'now');

  const attemptById = new Map<string, DebitAttempt>();
  const attemptsByDebit = new Map<string, DebitAttempt[]>();

  for (const a of input.attempts) {
    if (!a.attemptId) throw new AadeshError('DebitAttempt.attemptId is required');
    if (!a.debitKey) throw new AadeshError(`DebitAttempt.debitKey is required (attemptId ${a.attemptId})`);
    if (!Number.isInteger(a.attemptNumber) || a.attemptNumber < 1) {
      throw new AadeshError(`attemptNumber must be an integer >= 1 (attemptId ${a.attemptId})`);
    }
    assertMoney(a.amountPaise, `attempt ${a.attemptId} amountPaise`);
    assertDate(a.presentedAt, `attempt ${a.attemptId} presentedAt`);
    if (attemptById.has(a.attemptId)) throw new AadeshError(`Duplicate attemptId: ${a.attemptId}`);
    attemptById.set(a.attemptId, a);
    const bucket = attemptsByDebit.get(a.debitKey);
    if (bucket) bucket.push(a);
    else attemptsByDebit.set(a.debitKey, [a]);
  }

  // Route outcomes: exact (by attemptId), debit-level (by debitKey), or orphan.
  const exactByAttempt = new Map<string, DebitOutcome[]>();
  const debitLevel = new Map<string, DebitOutcome[]>();
  const orphanOutcomes: DebitOutcome[] = [];

  for (const o of input.outcomes) {
    if (o.attemptId === undefined && o.debitKey === undefined) {
      throw new AadeshError('DebitOutcome needs at least one of attemptId or debitKey');
    }
    assertMoney(o.amountPaise, 'outcome amountPaise');
    assertDate(o.reportedAt, 'outcome reportedAt');
    if (!o.rawCode) throw new AadeshError('DebitOutcome.rawCode is required');

    const exact = o.attemptId !== undefined ? attemptById.get(o.attemptId) : undefined;
    if (exact) {
      const bucket = exactByAttempt.get(exact.attemptId);
      if (bucket) bucket.push(o);
      else exactByAttempt.set(exact.attemptId, [o]);
    } else if (o.debitKey !== undefined && attemptsByDebit.has(o.debitKey)) {
      const bucket = debitLevel.get(o.debitKey);
      if (bucket) bucket.push(o);
      else debitLevel.set(o.debitKey, [o]);
    } else {
      orphanOutcomes.push(o);
    }
  }

  const debits: ReconciledDebit[] = [];

  for (const [debitKey, rawAttempts] of attemptsByDebit) {
    const attempts = [...rawAttempts].sort(
      (a, b) => a.attemptNumber - b.attemptNumber || a.presentedAt.getTime() - b.presentedAt.getTime(),
    );
    const rail = attempts[0]!.rail;
    const debitAmount = attempts[0]!.amountPaise;
    const windowHours = input.returnWindowHours ?? getRailProfile(rail).returnWindowHours;

    // Seed each attempt with its exact outcomes.
    const states: AttemptState[] = attempts.map((attempt) => ({
      attempt,
      outcomes: [...(exactByAttempt.get(attempt.attemptId) ?? [])],
      hasSuccess: false,
      hasKnownFailure: false,
      hasUnknown: false,
      amountMismatch: false,
    }));

    // Attribute debit-level (anonymous) outcomes to still-unsettled attempts, oldest first.
    const anon = [...(debitLevel.get(debitKey) ?? [])].sort(
      (a, b) => a.reportedAt.getTime() - b.reportedAt.getTime(),
    );
    const leftover: DebitOutcome[] = [];
    for (const o of anon) {
      const target = states.find((s) => s.outcomes.length === 0);
      if (target) target.outcomes.push(o);
      else leftover.push(o);
    }

    // Derive per-attempt signals.
    for (const s of states) {
      for (const o of s.outcomes) {
        const cat = categoryOf(o);
        if (cat === 'success') s.hasSuccess = true;
        else if (cat === undefined) s.hasUnknown = true;
        else s.hasKnownFailure = true;
        if (o.amountPaise !== s.attempt.amountPaise) s.amountMismatch = true;
      }
    }
    // Leftover anonymous outcomes are extra settlements against this debit; a
    // mismatched amount on one is still a mismatch for the debit.
    const leftoverMismatch = leftover.some((o) => o.amountPaise !== debitAmount);

    const { status, unsettled } = classify(states, leftover, leftoverMismatch, now, windowHours);

    const reconciledAttempts: ReconciledAttempt[] = states.map((s) => {
      const outcome = representativeOutcome(s);
      return {
        attempt: s.attempt,
        outcome,
        category: outcome ? categoryOf(outcome) : undefined,
      };
    });

    debits.push({
      debitKey,
      rail,
      status,
      handling: RECONCILIATION_HANDLING[status],
      attempts: reconciledAttempts,
      unsettledAttemptIds: unsettled.map((a) => a.attemptId),
      explanation: explain(status, debitKey, attempts.length),
    });
  }

  debits.sort((a, b) => (a.debitKey < b.debitKey ? -1 : a.debitKey > b.debitKey ? 1 : 0));

  return {
    debits,
    orphanOutcomes,
    suppressRetryKeys: debits.filter((d) => d.handling.suppressRetry).map((d) => d.debitKey),
    reversalKeys: debits.filter((d) => d.handling.reversalRequired).map((d) => d.debitKey),
    reviewKeys: debits.filter((d) => d.handling.needsReview).map((d) => d.debitKey),
  };
}
