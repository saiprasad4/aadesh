import type { Rail } from './types';

/**
 * The operational rules of a recurring-debit rail. Defaults encode the current
 * RBI/NPCI framework. The returned object is deeply frozen... to use different
 * values (e.g. a sponsor-bank-specific attempt count), spread it into your own
 * copy rather than mutating the shared profile.
 */
export interface RailProfile {
  readonly rail: Rail;
  readonly displayName: string;
  /** `realtime` for UPI Autopay; `batch` (T+1..T+n) for NACH/e-mandate. */
  readonly settlement: 'realtime' | 'batch';
  /**
   * Maximum total debit attempts per cycle, *including* the original.
   * UPI Autopay: 4 (1 original + 3 retries), per the Aug-2025 UPI Autopay
   * changes... after the 4th attempt the execution is cancelled.
   * eNACH: `3` is a **library default only**... there is no authoritative
   * NPCI-wide cap; presentations vary by sponsor bank. Treat as unverified.
   */
  readonly maxDebitAttempts: number;
  /** Whether the eNACH attempt count is an authoritative figure (it is not). */
  readonly maxDebitAttemptsVerified: boolean;
  /** Pre-debit notification requirement (RBI e-mandate framework: 24h notice). */
  readonly preDebitNotice: { readonly required: boolean; readonly leadTimeHours: number };
  /**
   * Per-transaction ceiling below which no Additional Factor of Authentication
   * is required. Raised to ₹15,000 (from ₹5,000) on 16 Jun 2022.
   */
  readonly noAdditionalFactorLimitInr: number;
  /**
   * Higher no-AFA ceiling (₹1,00,000) for specific merchant categories: mutual-fund
   * subscriptions, insurance premiums and credit-card bill payments, per RBI
   * (12 Dec 2023) and NPCI/UPI/OC-151A. See {@link higherNoAdditionalFactorMccs}.
   */
  readonly higherNoAdditionalFactorLimitInr: number;
  /** Merchant Category Codes eligible for the higher no-AFA ceiling. */
  readonly higherNoAdditionalFactorMccs: readonly string[];
  /** Minimum spacing between retry attempts the library will schedule. */
  readonly minRetryGapHours: number;
  /**
   * Window (hours) after a debit is presented within which its outcome is
   * normally reported back. Past this, an attempt with no matching outcome is
   * treated as `timed_out` by reconciliation and should be status-probed, not
   * blindly retried (it may have actually settled). eNACH returns arrive
   * T+1..T+n in batch files, so the window is days; UPI Autopay resolves in near
   * real-time. Both values are conservative library defaults and are
   * sponsor/PSP dependent... override per your own agreement.
   */
  readonly returnWindowHours: number;
  /** Whether editing amount/date typically forces a full re-registration. */
  readonly amendmentRequiresReRegistration: boolean;
  /** Human-readable pointer to the governing rule(s). */
  readonly reference: string;
}

/**
 * MCCs eligible for the ₹1,00,000 no-AFA ceiling, per NPCI/UPI/OC-151A Annexure A.
 * Note: `6529` is domestically mapped by NPCI to "LIC" (life-insurance premiums)
 * and correctly belongs here... even though its ISO 18245 meaning is
 * "Remote Stored Value Load", so it can look out of place against a standard MCC table.
 */
const HIGHER_NO_AFA_MCCS: readonly string[] = Object.freeze([
  '5473', // Credit-card bill payments
  '5960', // Direct marketing... insurance services
  '6012', // Financial institutions
  '6211', // Securities... brokers/dealers (mutual funds)
  '6300', // Insurance sales/underwriting/premiums
  '6381', // Insurance premiums
  '6399', // Insurance... not elsewhere classified
  '6529', // NPCI: LIC (see note above)
]);

const PROFILES: Record<Rail, RailProfile> = {
  upi_autopay: Object.freeze({
    rail: 'upi_autopay',
    displayName: 'UPI Autopay',
    settlement: 'realtime',
    maxDebitAttempts: 4,
    maxDebitAttemptsVerified: true,
    preDebitNotice: Object.freeze({ required: true, leadTimeHours: 24 }),
    noAdditionalFactorLimitInr: 15000,
    higherNoAdditionalFactorLimitInr: 100000,
    higherNoAdditionalFactorMccs: HIGHER_NO_AFA_MCCS,
    minRetryGapHours: 1,
    returnWindowHours: 24,
    amendmentRequiresReRegistration: false,
    reference:
      'UPI Autopay attempt cap (1+3) per the Aug-2025 UPI Autopay changes; RBI Digital Payments E-mandate Framework, 2026 (RBI/DPSS/2026-27/396) for 24h notice and no-AFA limits; NPCI/UPI/OC-151A for the ₹1L MCC list.',
  }),
  enach: Object.freeze({
    rail: 'enach',
    displayName: 'eNACH / e-mandate',
    settlement: 'batch',
    maxDebitAttempts: 3,
    maxDebitAttemptsVerified: false,
    preDebitNotice: Object.freeze({ required: true, leadTimeHours: 24 }),
    noAdditionalFactorLimitInr: 15000,
    higherNoAdditionalFactorLimitInr: 100000,
    higherNoAdditionalFactorMccs: HIGHER_NO_AFA_MCCS,
    minRetryGapHours: 24,
    returnWindowHours: 96,
    amendmentRequiresReRegistration: true,
    reference:
      'RBI Digital Payments E-mandate Framework, 2026 (RBI/DPSS/2026-27/396). Attempt count is sponsor-bank dependent... no authoritative NPCI-wide cap exists (default 3, unverified).',
  }),
};

/** Return the (frozen) operating profile for a rail. */
export function getRailProfile(rail: Rail): RailProfile {
  return PROFILES[rail];
}

/** All rail profiles (frozen). */
export function railProfiles(): readonly RailProfile[] {
  return Object.freeze([PROFILES.upi_autopay, PROFILES.enach]);
}
