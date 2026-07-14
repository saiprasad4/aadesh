/**
 * Reconciliation contracts: match what the bank/PSP actually did (outcomes)
 * back to what you tried to do (attempts), so a retried success never reads as a
 * double debit and a lost outcome never gets blindly retried.
 *
 * The hard case this exists for is the async-return-versus-retry race. eNACH is a
 * batch rail: a return can land T+n, in a file, *after* you have already
 * scheduled a retry. Matching that late success back to the original attempt, and
 * suppressing the now-redundant retry, is where double debits are actually
 * prevented. UPI Autopay hides this because the answer comes back inline, but the
 * same primitive covers both rails.
 *
 * Everything here is pure and deterministic: you pass in your attempts and the
 * outcomes you have received, and reconciliation tells you the truth. It does no
 * I/O and never touches payment data.
 */

import type { ErrorCategory, Rail } from '../types';

/**
 * A single debit you presented against a mandate. One attempt per presentation;
 * a retry is a new attempt that shares the original's {@link debitKey}.
 */
export interface DebitAttempt {
  /** Unique id for THIS presentation. */
  readonly attemptId: string;
  /**
   * Logical-debit key: the stable identity of the one intended charge this
   * attempt belongs to. Every retry of the same due debit shares one `debitKey`
   * (e.g. `` `${mandateRef}:${dueDate}` ``). This is the idempotency key
   * reconciliation groups on, so it must NOT encode the attempt number.
   */
  readonly debitKey: string;
  readonly rail: Rail;
  /** Amount presented, in integer paise. Floats and negatives are rejected. */
  readonly amountPaise: number;
  /** 1-based attempt number within the logical debit. */
  readonly attemptNumber: number;
  /** When this attempt was presented to the rail. */
  readonly presentedAt: Date;
}

/**
 * An outcome reported by a bank/PSP return file or webhook.
 *
 * Prefer supplying {@link attemptId} so the outcome pairs to an exact
 * presentation. eNACH return files that echo only the mandate/UMRN can supply
 * {@link debitKey} instead; such outcomes are attributed to the debit's
 * unsettled attempts in presentation order, which is more conservative.
 */
export interface DebitOutcome {
  /** The attempt this outcome is for, when the return carries the reference. */
  readonly attemptId?: string;
  /** Logical-debit key, used when {@link attemptId} is absent. */
  readonly debitKey?: string;
  readonly rail: Rail;
  /** Amount the bank reported, in integer paise. */
  readonly amountPaise: number;
  /** Raw return/response code exactly as emitted. */
  readonly rawCode: string;
  /** When the outcome was reported. */
  readonly reportedAt: Date;
}

/**
 * The reconciled state of one logical debit. Ordered dangerous-first: the earlier
 * a status appears here, the more it demands action before any money moves again.
 */
export type ReconciliationStatus =
  /** Two or more attempts provably settled. Money is owed back. */
  | 'double_debit_confirmed'
  /** A success landed while another attempt is still open. The retry must be suppressed now. */
  | 'double_debit_risk'
  /** A reported amount disagrees with what was presented. Do not treat as settled. */
  | 'amount_mismatch'
  /** Exactly one clean success, amounts agree, no open siblings. */
  | 'settled'
  /** Every attempt has a known failure outcome; no money moved. */
  | 'failed'
  /** Attempt(s) presented, no outcome yet, still within the rail's return window. */
  | 'pending'
  /** No outcome past the return window. Probe status before any retry. */
  | 'timed_out'
  /** Cannot be classified safely (unknown code, unattributable duplicate). Hold for review. */
  | 'ambiguous';

/**
 * What to do about a reconciled debit. Mirrors the category-driven handling used
 * for error codes: the policy lives in one table, not scattered per status.
 */
export interface ReconciliationHandling {
  /** Is the truth known and internally consistent (settled or cleanly failed)? */
  readonly resolved: boolean;
  /** Must a scheduled or in-flight retry for this debit be suppressed right now? */
  readonly suppressRetry: boolean;
  /** Is a duplicate charge owed back to the customer? */
  readonly reversalRequired: boolean;
  /** Does this need a human decision rather than an automated one? */
  readonly needsReview: boolean;
  /** Plain-English message safe to surface to an end customer. */
  readonly customerMessage: string;
  /** What a developer / ops team should do about it. */
  readonly suggestedAction: string;
}

/** One attempt paired with the outcome that reconciled to it, if any. */
export interface ReconciledAttempt {
  readonly attempt: DebitAttempt;
  /** The outcome matched to this attempt, or `undefined` if still unsettled. */
  readonly outcome?: DebitOutcome;
  /** Normalized category of the matched outcome's code, if matched and recognized. */
  readonly category?: ErrorCategory;
}

/** The reconciled truth for one logical debit (one `debitKey`). */
export interface ReconciledDebit {
  readonly debitKey: string;
  readonly rail: Rail;
  readonly status: ReconciliationStatus;
  readonly handling: ReconciliationHandling;
  readonly attempts: readonly ReconciledAttempt[];
  /** Attempts still awaiting an outcome. A retry among these is the double-debit risk. */
  readonly unsettledAttemptIds: readonly string[];
  /** One-line explanation, safe for ops logs. */
  readonly explanation: string;
}

/** Inputs for {@link reconcile}. */
export interface ReconcileInput {
  readonly attempts: readonly DebitAttempt[];
  readonly outcomes: readonly DebitOutcome[];
  /** Clock for deciding pending vs timed_out. Defaults to `new Date()`. */
  readonly now?: Date;
  /**
   * Override the return window (hours) after which a still-unmatched attempt is
   * `timed_out` rather than `pending`. Defaults to the rail's
   * `returnWindowHours`.
   */
  readonly returnWindowHours?: number;
}

/** The full reconciliation result. */
export interface ReconciliationReport {
  /** One entry per logical debit, sorted by `debitKey`. */
  readonly debits: readonly ReconciledDebit[];
  /** Outcomes that matched no attempt in the input at all. */
  readonly orphanOutcomes: readonly DebitOutcome[];
  /** `debitKey`s whose scheduled/in-flight retry must be suppressed now. */
  readonly suppressRetryKeys: readonly string[];
  /** `debitKey`s that need a reversal/refund. */
  readonly reversalKeys: readonly string[];
  /** `debitKey`s that need a manual review. */
  readonly reviewKeys: readonly string[];
}
