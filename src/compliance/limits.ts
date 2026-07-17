import { AadeshError } from '../errors';
import { getRailProfile } from '../rails';
import type { Rail } from '../types';

/**
 * Additional Factor of Authentication (AFA) and mandate-cap checks for a single
 * debit, driven entirely by the rail profile so the thresholds stay in one place.
 *
 * Per the RBI Digital Payments E-mandate Framework, 2026: a recurring debit up to
 * the no-AFA ceiling executes without AFA; above it, AFA is required each time.
 * The ceiling is ₹15,000 by default and ₹1,00,000 for the eligible merchant
 * categories (insurance premiums, mutual-fund subscriptions, credit-card bills),
 * identified here by MCC. "Up to" is inclusive: an amount exactly at the ceiling
 * does not need AFA.
 */

function assertPositiveIntegerPaise(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new AadeshError(`${label} must be a positive integer in paise; got ${value}`);
  }
}

export interface DebitLimitInput {
  readonly rail: Rail;
  /** The amount of this debit, in integer paise. */
  readonly amountPaise: number;
  /** Merchant Category Code, if known. Determines eligibility for the higher ceiling. */
  readonly mcc?: string;
  /** The mandate's registered maximum debit amount, in integer paise, if any. */
  readonly mandateMaxAmountPaise?: number;
}

export type DebitLimitFlag = 'afa_required' | 'higher_ceiling_applied' | 'exceeds_mandate_max';

export interface DebitLimitCheck {
  /** Whether an Additional Factor of Authentication is required for this debit. */
  readonly afaRequired: boolean;
  /** The no-AFA ceiling that applied to this debit, in integer paise. */
  readonly noAfaCeilingPaise: number;
  /** Whether the higher (category) ceiling was applied rather than the default. */
  readonly higherCeilingApplied: boolean;
  /** Whether the amount is within the mandate's registered maximum (true when no max is given). */
  readonly withinMandateMax: boolean;
  /** Machine-readable flags describing what the check found. */
  readonly flags: readonly DebitLimitFlag[];
  /** Plain-English explanation of the outcome. */
  readonly explanation: string;
}

/**
 * Check a debit against the AFA ceiling and, if provided, the mandate's maximum.
 * The check never blocks a debit on its own... it tells you whether AFA is needed
 * and whether the amount is within the registered cap, so the caller decides.
 */
export function checkDebitLimits(input: DebitLimitInput): DebitLimitCheck {
  assertPositiveIntegerPaise(input.amountPaise, 'amountPaise');
  if (input.mandateMaxAmountPaise !== undefined) {
    assertPositiveIntegerPaise(input.mandateMaxAmountPaise, 'mandateMaxAmountPaise');
  }

  const profile = getRailProfile(input.rail);
  const higherCeilingApplied =
    input.mcc !== undefined && profile.higherNoAdditionalFactorMccs.includes(input.mcc);
  const ceilingInr = higherCeilingApplied
    ? profile.higherNoAdditionalFactorLimitInr
    : profile.noAdditionalFactorLimitInr;
  const noAfaCeilingPaise = ceilingInr * 100;

  const afaRequired = input.amountPaise > noAfaCeilingPaise;
  const withinMandateMax =
    input.mandateMaxAmountPaise === undefined || input.amountPaise <= input.mandateMaxAmountPaise;

  const flags: DebitLimitFlag[] = [];
  if (afaRequired) {
    flags.push('afa_required');
  }
  if (higherCeilingApplied) {
    flags.push('higher_ceiling_applied');
  }
  if (!withinMandateMax) {
    flags.push('exceeds_mandate_max');
  }

  return {
    afaRequired,
    noAfaCeilingPaise,
    higherCeilingApplied,
    withinMandateMax,
    flags: Object.freeze(flags),
    explanation: explain(afaRequired, ceilingInr, higherCeilingApplied, withinMandateMax),
  };
}

function explain(
  afaRequired: boolean,
  ceilingInr: number,
  higher: boolean,
  withinMandateMax: boolean,
): string {
  const ceiling = `₹${ceilingInr.toLocaleString('en-IN')}`;
  const tier = higher ? `the higher category ceiling of ${ceiling}` : `the ${ceiling} ceiling`;
  const afa = afaRequired
    ? `Amount is above ${tier}, so AFA is required for this debit.`
    : `Amount is within ${tier}, so no AFA is required.`;
  const cap = withinMandateMax ? '' : ' Amount also exceeds the mandate maximum and should be rejected.';
  return `${afa}${cap}`;
}
