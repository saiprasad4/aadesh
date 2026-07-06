import type { CategoryHandling, ErrorCategory } from '../types';

/**
 * Authoritative, hand-authored handling policy per normalized category.
 *
 * This is the deterministic core of the library: rather than tune retry/terminal
 * behaviour for each of the hundreds of raw bank/NPCI/PSP codes, every code
 * collapses to one of these categories and inherits consistent handling.
 *
 * Defaults are **conservative for money**: a category is only `retriable: true`
 * when a later attempt is genuinely likely to succeed and is safe to make
 * automatically (insufficient funds, transient bank/network faults, a single bad
 * OTP). Anything ambiguous, permanent, fraud-flagged, or locked is NOT
 * auto-retriable... the caller must decide. `terminal: true` means the mandate
 * itself is dead and must be re-registered.
 */
export const CATEGORY_HANDLING: Record<ErrorCategory, CategoryHandling> = {
  success: {
    retriable: false,
    terminal: false,
    customerMessage: 'Your payment was successful.',
    suggestedAction:
      'This is a success/approval code, not a failure. Do not retry; mark the debit succeeded.',
  },
  insufficient_funds: {
    retriable: true,
    terminal: false,
    customerMessage:
      'There were not enough funds in your account. Please keep the balance ready and we will retry.',
    suggestedAction:
      'Retry within the attempt cap, ideally aligned to the customer’s salary/credit cycle. Notify the customer to fund the account.',
  },
  account_closed: {
    retriable: false,
    terminal: true,
    customerMessage:
      'The linked bank account is closed. Please set up the mandate again with an active account.',
    suggestedAction: 'Mark the mandate dead. Trigger a fresh mandate registration on a different account.',
  },
  account_frozen: {
    retriable: false,
    terminal: true,
    customerMessage:
      'The linked bank account is frozen. Please contact your bank and set up the mandate again.',
    suggestedAction: 'Stop retries. Ask the customer to resolve with their bank, then re-register.',
  },
  account_blocked: {
    retriable: false,
    terminal: true,
    customerMessage: 'The linked bank account is blocked. Please set up the mandate again once resolved.',
    suggestedAction: 'Stop retries; re-register after the customer resolves the block.',
  },
  account_inoperative: {
    retriable: false,
    terminal: true,
    customerMessage:
      'The linked bank account is inactive. Please set up the mandate again with an active account.',
    suggestedAction: 'Treat as dead mandate; prompt re-registration.',
  },
  no_such_account: {
    retriable: false,
    terminal: true,
    customerMessage:
      'The bank account could not be found. Please set up the mandate again with correct details.',
    suggestedAction: 'Do not retry. Collect corrected account details and re-register.',
  },
  account_details_mismatch: {
    retriable: false,
    terminal: true,
    customerMessage:
      'The bank account details did not match. Please set up the mandate again with correct details.',
    suggestedAction: 'Re-register with verified account holder / number / IFSC.',
  },
  mandate_not_found: {
    retriable: false,
    terminal: true,
    customerMessage: 'We could not find an active mandate. Please set one up to continue.',
    suggestedAction: 'Re-register; verify you are quoting the correct UMRN / mandate reference.',
  },
  mandate_not_registered: {
    retriable: false,
    terminal: true,
    customerMessage: 'Your mandate is not active yet. Please complete the setup to continue.',
    suggestedAction: 'Do not debit until registration confirms active. Re-drive the registration flow.',
  },
  mandate_cancelled: {
    retriable: false,
    terminal: true,
    customerMessage: 'This mandate has been cancelled. Please set up a new one to continue.',
    suggestedAction: 'Mark dead; prompt a fresh mandate.',
  },
  mandate_paused: {
    retriable: false,
    terminal: false,
    customerMessage: 'This mandate is currently paused. Debits will resume once it is active again.',
    suggestedAction: 'Resume the mandate before retrying; do not count as a failed cycle.',
  },
  mandate_expired: {
    retriable: false,
    terminal: true,
    customerMessage: 'This mandate has expired. Please set up a new one to continue.',
    suggestedAction: 'Mark dead; register a new mandate with a valid validity window.',
  },
  mandate_already_exists: {
    retriable: false,
    terminal: false,
    customerMessage: 'A mandate already exists for this account.',
    suggestedAction: 'Reuse the existing active mandate instead of registering a duplicate.',
  },
  limit_exceeded: {
    retriable: false,
    terminal: false,
    customerMessage:
      'This amount exceeds the limit approved on your mandate. Please approve the higher amount.',
    suggestedAction: 'Debit within the mandate’s max amount, or amend/re-register for a higher cap.',
  },
  amount_mismatch: {
    retriable: false,
    terminal: false,
    customerMessage: 'The debit amount did not match your mandate terms. Please try again.',
    suggestedAction: 'Align the debit amount with the mandate; re-present.',
  },
  authentication_failed: {
    retriable: true,
    terminal: false,
    customerMessage: 'We could not verify the payment. Please try again.',
    suggestedAction: 'A single failed OTP/MPIN. Re-drive authentication and retry within the cap.',
  },
  authentication_locked: {
    retriable: false,
    terminal: false,
    customerMessage: 'Too many verification attempts. Please wait and try again later.',
    suggestedAction:
      'Max OTP/PIN tries exceeded... do NOT auto-retry (it extends the lock). Require a cool-down and fresh customer-initiated authentication.',
  },
  authorization_failed: {
    retriable: false,
    terminal: false,
    customerMessage: 'The payment could not be authorized. Please try again later or contact your bank.',
    suggestedAction:
      'Ambiguous authorization decline... do NOT auto-retry. Inspect the specific code; some are permanent (see not_permitted) and some are transient.',
  },
  not_permitted: {
    retriable: false,
    terminal: true,
    customerMessage:
      'This account cannot be used for this payment. Please set up the mandate with a different account.',
    suggestedAction:
      'Permanent account/type restriction (e.g. view-only, NRE/minor, do-not-honour). Never retry; re-register on an eligible account.',
  },
  suspected_fraud: {
    retriable: false,
    terminal: true,
    customerMessage: 'This payment was declined for your security. Please contact your bank.',
    suggestedAction:
      'Risk/fraud decline. NEVER auto-retry (retrying a risk-declined debit is a compliance red flag). Escalate to risk/ops and stop the mandate.',
  },
  consent_declined: {
    retriable: false,
    terminal: true,
    customerMessage: 'The mandate request was declined. Please set it up again if you wish to continue.',
    suggestedAction: 'Customer explicitly declined; do not retry automatically. Re-offer the mandate.',
  },
  invalid_details: {
    retriable: false,
    terminal: false,
    customerMessage: 'Some details were invalid. Please try again with correct information.',
    suggestedAction: 'Fix the offending field (VPA, account, IFSC, amount) and re-present.',
  },
  duplicate: {
    retriable: false,
    terminal: false,
    customerMessage: 'This looks like a duplicate request.',
    suggestedAction: 'De-duplicate on your reference id; do not double-charge.',
  },
  kyc_issue: {
    retriable: false,
    terminal: false,
    customerMessage: 'A KYC check is pending on your account. Please complete it to continue.',
    suggestedAction: 'Pause debits until KYC/re-KYC clears; then retry.',
  },
  bank_offline: {
    retriable: true,
    terminal: false,
    customerMessage: 'Your bank was temporarily unavailable. We will try again shortly.',
    suggestedAction: 'Transient. Retry after a delay within the cap.',
  },
  timeout: {
    retriable: true,
    terminal: false,
    customerMessage: 'The request timed out. We will try again shortly.',
    suggestedAction: 'Transient. Reconcile the outcome (it may have succeeded) before retrying.',
  },
  network_error: {
    retriable: true,
    terminal: false,
    customerMessage: 'A temporary network issue occurred. We will try again shortly.',
    suggestedAction: 'Transient. Retry after a delay; reconcile to avoid double debits.',
  },
  technical_error: {
    retriable: true,
    terminal: false,
    customerMessage: 'A temporary technical issue occurred. We will try again shortly.',
    suggestedAction: 'Transient. Retry within the cap; escalate if it persists across cycles.',
  },
  other: {
    retriable: false,
    terminal: false,
    customerMessage: 'The payment could not be completed. Please try again.',
    suggestedAction:
      'Unclassified... do NOT auto-retry. Inspect the raw code/reason and classify before automating.',
  },
};
