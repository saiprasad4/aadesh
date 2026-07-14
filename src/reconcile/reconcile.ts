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

function assertNonNegativeIntegerPaise(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new AadeshError(`${label} must be a non-negative integer in paise; got ${value}`);
  }
}

function assertValidDate(value: unknown, label: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new AadeshError(`${label} must be a valid Date`);
  }
}

function categoryOf(outcome: DebitOutcome): ErrorCategory | undefined {
  return getErrorCode(outcome.rawCode, { rail: outcome.rail })?.category;
}

/** One attempt with the outcomes matched to it and the signals we classify on. */
interface AttemptReconciliation {
  readonly attempt: DebitAttempt;
  readonly matchedOutcomes: DebitOutcome[];
  hasSuccess: boolean;
  hasKnownFailure: boolean;
  hasUnknownCode: boolean;
  hasAmountMismatch: boolean;
}

/** The single outcome most worth surfacing for an attempt: a success, else the latest. */
function pickRepresentativeOutcome(attemptReconciliation: AttemptReconciliation): DebitOutcome | undefined {
  const { matchedOutcomes } = attemptReconciliation;
  if (matchedOutcomes.length === 0) return undefined;
  const successOutcome = matchedOutcomes.find((outcome) => categoryOf(outcome) === 'success');
  if (successOutcome) return successOutcome;
  return [...matchedOutcomes].sort(
    (first, second) => second.reportedAt.getTime() - first.reportedAt.getTime(),
  )[0];
}

function classify(
  attemptReconciliations: AttemptReconciliation[],
  unattributedOutcomes: DebitOutcome[],
  unattributedAmountMismatch: boolean,
  now: Date,
  returnWindowHours: number,
): { status: ReconciliationStatus; unsettledAttempts: DebitAttempt[] } {
  const settledSuccessAttemptIds = new Set(
    attemptReconciliations.filter((each) => each.hasSuccess).map((each) => each.attempt.attemptId),
  );
  const unattributedSuccessCount = unattributedOutcomes.filter(
    (outcome) => categoryOf(outcome) === 'success',
  ).length;
  const totalSuccessSignals = settledSuccessAttemptIds.size + unattributedSuccessCount;

  const unsettledAttempts = attemptReconciliations
    .filter((each) => each.matchedOutcomes.length === 0)
    .map((each) => each.attempt);
  const hasUnsettledAttempt = unsettledAttempts.length > 0;

  const hasUnknownCode =
    attemptReconciliations.some((each) => each.hasUnknownCode) ||
    unattributedOutcomes.some((outcome) => categoryOf(outcome) === undefined);
  const hasAmountMismatch =
    attemptReconciliations.some((each) => each.hasAmountMismatch) || unattributedAmountMismatch;

  // One attempt reporting both a success and a failure is internally contradictory.
  const hasSelfContradiction = attemptReconciliations.some((each) => each.hasSuccess && each.hasKnownFailure);

  let status: ReconciliationStatus;
  if (settledSuccessAttemptIds.size >= 2) {
    status = 'double_debit_confirmed';
  } else if (totalSuccessSignals >= 2) {
    // One provable success plus another success we cannot pin to a distinct attempt:
    // could be a duplicate report or a second settlement. Do not auto-reverse.
    status = 'ambiguous';
  } else if (hasSelfContradiction) {
    status = 'ambiguous';
  } else if (hasAmountMismatch) {
    status = 'amount_mismatch';
  } else if (totalSuccessSignals === 1) {
    if (hasUnsettledAttempt) status = 'double_debit_risk';
    else if (hasUnknownCode) status = 'ambiguous';
    else status = 'settled';
  } else {
    // No successes at all.
    if (hasUnknownCode) {
      status = 'ambiguous';
    } else if (hasUnsettledAttempt) {
      const anyAttemptOverdue = unsettledAttempts.some(
        (attempt) => attempt.presentedAt.getTime() + returnWindowHours * HOUR_MS <= now.getTime(),
      );
      status = anyAttemptOverdue ? 'timed_out' : 'pending';
    } else {
      status = 'failed';
    }
  }

  return { status, unsettledAttempts };
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
  assertValidDate(now, 'now');

  const attemptsById = new Map<string, DebitAttempt>();
  const attemptsByDebitKey = new Map<string, DebitAttempt[]>();

  for (const attempt of input.attempts) {
    if (!attempt.attemptId) throw new AadeshError('DebitAttempt.attemptId is required');
    if (!attempt.debitKey) {
      throw new AadeshError(`DebitAttempt.debitKey is required (attemptId ${attempt.attemptId})`);
    }
    if (!Number.isInteger(attempt.attemptNumber) || attempt.attemptNumber < 1) {
      throw new AadeshError(`attemptNumber must be an integer >= 1 (attemptId ${attempt.attemptId})`);
    }
    assertNonNegativeIntegerPaise(attempt.amountPaise, `attempt ${attempt.attemptId} amountPaise`);
    assertValidDate(attempt.presentedAt, `attempt ${attempt.attemptId} presentedAt`);
    if (attemptsById.has(attempt.attemptId)) {
      throw new AadeshError(`Duplicate attemptId: ${attempt.attemptId}`);
    }
    attemptsById.set(attempt.attemptId, attempt);
    const debitGroup = attemptsByDebitKey.get(attempt.debitKey);
    if (debitGroup) debitGroup.push(attempt);
    else attemptsByDebitKey.set(attempt.debitKey, [attempt]);
  }

  // Route each outcome: exact (by attemptId), debit-level (by debitKey), or orphan.
  const outcomesByAttemptId = new Map<string, DebitOutcome[]>();
  const debitLevelOutcomesByKey = new Map<string, DebitOutcome[]>();
  const orphanOutcomes: DebitOutcome[] = [];

  for (const outcome of input.outcomes) {
    if (outcome.attemptId === undefined && outcome.debitKey === undefined) {
      throw new AadeshError('DebitOutcome needs at least one of attemptId or debitKey');
    }
    assertNonNegativeIntegerPaise(outcome.amountPaise, 'outcome amountPaise');
    assertValidDate(outcome.reportedAt, 'outcome reportedAt');
    if (!outcome.rawCode) throw new AadeshError('DebitOutcome.rawCode is required');

    const matchedAttempt = outcome.attemptId !== undefined ? attemptsById.get(outcome.attemptId) : undefined;
    if (matchedAttempt) {
      const existing = outcomesByAttemptId.get(matchedAttempt.attemptId);
      if (existing) existing.push(outcome);
      else outcomesByAttemptId.set(matchedAttempt.attemptId, [outcome]);
    } else if (outcome.debitKey !== undefined && attemptsByDebitKey.has(outcome.debitKey)) {
      const existing = debitLevelOutcomesByKey.get(outcome.debitKey);
      if (existing) existing.push(outcome);
      else debitLevelOutcomesByKey.set(outcome.debitKey, [outcome]);
    } else {
      orphanOutcomes.push(outcome);
    }
  }

  const reconciledDebits: ReconciledDebit[] = [];

  for (const [debitKey, debitAttempts] of attemptsByDebitKey) {
    const orderedAttempts = [...debitAttempts].sort(
      (left, right) =>
        left.attemptNumber - right.attemptNumber || left.presentedAt.getTime() - right.presentedAt.getTime(),
    );
    const rail = orderedAttempts[0]!.rail;
    const debitAmountPaise = orderedAttempts[0]!.amountPaise;
    const returnWindowHours = input.returnWindowHours ?? getRailProfile(rail).returnWindowHours;

    // Seed each attempt with the outcomes that reference it by attemptId.
    const attemptReconciliations: AttemptReconciliation[] = orderedAttempts.map((attempt) => ({
      attempt,
      matchedOutcomes: [...(outcomesByAttemptId.get(attempt.attemptId) ?? [])],
      hasSuccess: false,
      hasKnownFailure: false,
      hasUnknownCode: false,
      hasAmountMismatch: false,
    }));

    // Attribute debit-level outcomes (no attemptId) to still-unsettled attempts, oldest first.
    const debitLevelOutcomes = [...(debitLevelOutcomesByKey.get(debitKey) ?? [])].sort(
      (earlier, later) => earlier.reportedAt.getTime() - later.reportedAt.getTime(),
    );
    const unattributedOutcomes: DebitOutcome[] = [];
    for (const outcome of debitLevelOutcomes) {
      const openAttempt = attemptReconciliations.find((each) => each.matchedOutcomes.length === 0);
      if (openAttempt) openAttempt.matchedOutcomes.push(outcome);
      else unattributedOutcomes.push(outcome);
    }

    // Derive per-attempt signals from its matched outcomes.
    for (const attemptReconciliation of attemptReconciliations) {
      for (const outcome of attemptReconciliation.matchedOutcomes) {
        const category = categoryOf(outcome);
        if (category === 'success') attemptReconciliation.hasSuccess = true;
        else if (category === undefined) attemptReconciliation.hasUnknownCode = true;
        else attemptReconciliation.hasKnownFailure = true;
        if (outcome.amountPaise !== attemptReconciliation.attempt.amountPaise) {
          attemptReconciliation.hasAmountMismatch = true;
        }
      }
    }
    // A leftover outcome whose amount disagrees is a mismatch for the whole debit.
    const unattributedAmountMismatch = unattributedOutcomes.some(
      (outcome) => outcome.amountPaise !== debitAmountPaise,
    );

    const { status, unsettledAttempts } = classify(
      attemptReconciliations,
      unattributedOutcomes,
      unattributedAmountMismatch,
      now,
      returnWindowHours,
    );

    const reconciledAttempts: ReconciledAttempt[] = attemptReconciliations.map((attemptReconciliation) => {
      const representativeOutcome = pickRepresentativeOutcome(attemptReconciliation);
      return {
        attempt: attemptReconciliation.attempt,
        outcome: representativeOutcome,
        category: representativeOutcome ? categoryOf(representativeOutcome) : undefined,
      };
    });

    reconciledDebits.push({
      debitKey,
      rail,
      status,
      handling: RECONCILIATION_HANDLING[status],
      attempts: reconciledAttempts,
      unsettledAttemptIds: unsettledAttempts.map((attempt) => attempt.attemptId),
      explanation: explain(status, debitKey, orderedAttempts.length),
    });
  }

  reconciledDebits.sort((left, right) =>
    left.debitKey < right.debitKey ? -1 : left.debitKey > right.debitKey ? 1 : 0,
  );

  return {
    debits: reconciledDebits,
    orphanOutcomes,
    suppressRetryKeys: reconciledDebits
      .filter((debit) => debit.handling.suppressRetry)
      .map((debit) => debit.debitKey),
    reversalKeys: reconciledDebits
      .filter((debit) => debit.handling.reversalRequired)
      .map((debit) => debit.debitKey),
    reviewKeys: reconciledDebits.filter((debit) => debit.handling.needsReview).map((debit) => debit.debitKey),
  };
}
