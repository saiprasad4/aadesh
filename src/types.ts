/**
 * Core domain contracts for the Indian recurring-payment mandate lifecycle.
 *
 * Two rails are modelled behind one vocabulary:
 *  - `enach`... NACH / e-mandate (batch, destination-bank dependent, T+1..T+n)
 *  - `upi_autopay`... UPI Autopay (real-time, PSP/app dependent)
 *
 * Error handling is deliberately *category-driven*: a raw bank/NPCI/PSP code maps
 * to a normalized {@link ErrorCategory}, and the retry/terminal/customer-message
 * behaviour is derived from that category (see `CATEGORY_HANDLING`). This keeps
 * handling consistent across the hundreds of raw codes rather than hand-tuning
 * each one.
 */

/** The recurring-debit rail a mandate runs on. */
export type Rail = 'enach' | 'upi_autopay';

/**
 * Which layer of the stack surfaced a given error code. The same failure is
 * reported differently by the app, the PSP, the sponsor bank, the destination
 * bank and NPCI... knowing the layer is essential to routing a fix.
 */
export type MandateLayer = 'npci' | 'sponsor_bank' | 'destination_bank' | 'psp' | 'app';

/**
 * Normalized failure category. Every raw code collapses to one of these so that
 * retry/terminal decisions and customer messaging are consistent regardless of
 * which bank or PSP emitted the code.
 */
export type ErrorCategory =
  | 'success'
  | 'insufficient_funds'
  | 'account_closed'
  | 'account_frozen'
  | 'account_blocked'
  | 'account_inoperative'
  | 'no_such_account'
  | 'account_details_mismatch'
  | 'mandate_not_found'
  | 'mandate_not_registered'
  | 'mandate_cancelled'
  | 'mandate_paused'
  | 'mandate_expired'
  | 'mandate_already_exists'
  | 'limit_exceeded'
  | 'amount_mismatch'
  | 'authentication_failed'
  | 'authentication_locked'
  | 'authorization_failed'
  | 'not_permitted'
  | 'suspected_fraud'
  | 'consent_declined'
  | 'invalid_details'
  | 'duplicate'
  | 'kyc_issue'
  | 'bank_offline'
  | 'timeout'
  | 'network_error'
  | 'technical_error'
  | 'other';

/**
 * Category-level handling policy. Derived defaults for how to treat any code in
 * a category. Individual raw codes may override `retriable`/`terminal`.
 */
export interface CategoryHandling {
  /** Is a later re-attempt plausibly successful (e.g. insufficient funds)? */
  retriable: boolean;
  /** Is the mandate itself dead, requiring re-registration (e.g. account closed)? */
  terminal: boolean;
  /** Plain-English message safe to surface to an end customer. */
  customerMessage: string;
  /** What a developer / ops team should do about it. */
  suggestedAction: string;
}

/**
 * A raw error/return/decline code as emitted by a bank, NPCI or a PSP, mapped to
 * a normalized category. This is the shape of the shipped dataset entries.
 */
export interface RawErrorCode {
  /** The raw code string exactly as emitted, e.g. `"01"`, `"M016"`, `"U16"`. */
  code: string;
  /** Rail this code applies to, or `"both"`. */
  rail: Rail | 'both';
  /** Which layer surfaces the code. */
  layer: MandateLayer;
  /** Official / documented description of the code. */
  reason: string;
  /** Normalized category the code collapses to. */
  category: ErrorCategory;
  /**
   * `true` when the code + its meaning are corroborated by an authoritative
   * primary/aggregator source (NPCI/RBI/NACH tables). `false` for entries drawn
   * only from a single vendor's normalized reason strings.
   */
  verified: boolean;
  /** Provenance: the source URL the entry was reconciled against. */
  source: string;
  /** Optional note flagging ambiguity, a domestic override, or a caveat. */
  note?: string;
}

/**
 * A fully-resolved error code: the raw entry merged with its category handling.
 * This is what {@link getErrorCode} returns. Handling is derived purely from
 * {@link RawErrorCode.category}... there are no per-code behaviour overrides, so
 * every code in a category behaves identically. Extending both interfaces keeps
 * the shape in sync with `RawErrorCode` automatically.
 */
export interface MandateErrorCode extends RawErrorCode, CategoryHandling {}
