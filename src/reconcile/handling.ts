import type { ReconciliationHandling, ReconciliationStatus } from './types';

/**
 * The authoritative action policy per reconciliation status. Conservative by
 * design: anything that cannot be proven settled suppresses retries and asks for
 * review rather than guessing with money. Frozen so the shared policy cannot be
 * mutated at runtime.
 */
export const RECONCILIATION_HANDLING: Record<ReconciliationStatus, ReconciliationHandling> = Object.freeze({
  double_debit_confirmed: {
    resolved: false,
    suppressRetry: true,
    reversalRequired: true,
    needsReview: true,
    customerMessage: 'We spotted a duplicate charge and are reversing it.',
    suggestedAction:
      'Two attempts settled for one debit. Initiate a reversal/refund for the duplicate and reconcile the ledger.',
  },
  double_debit_risk: {
    resolved: false,
    suppressRetry: true,
    reversalRequired: false,
    needsReview: true,
    customerMessage: 'Your payment went through.',
    suggestedAction:
      'A success landed while another attempt is still open. Suppress the pending/in-flight retry now, then confirm the other attempt did not also settle.',
  },
  amount_mismatch: {
    resolved: false,
    suppressRetry: true,
    reversalRequired: false,
    needsReview: true,
    customerMessage: 'We are verifying the amount of your payment.',
    suggestedAction:
      'The reported amount differs from the amount presented. Do not treat as settled; investigate a partial or incorrect settlement.',
  },
  settled: {
    resolved: true,
    suppressRetry: true,
    reversalRequired: false,
    needsReview: false,
    customerMessage: 'Your payment went through.',
    suggestedAction: 'Mark the debit settled. No retry needed.',
  },
  failed: {
    resolved: true,
    suppressRetry: false,
    reversalRequired: false,
    needsReview: false,
    customerMessage: 'Your payment did not go through.',
    suggestedAction:
      'No money moved. Decide on a retry with decideRetry() using the failure code, subject to the attempt cap.',
  },
  pending: {
    resolved: false,
    suppressRetry: false,
    reversalRequired: false,
    needsReview: false,
    customerMessage: 'Your payment is being processed.',
    suggestedAction: 'Outcome not in yet and still within the return window. Wait; do not retry or reverse.',
  },
  timed_out: {
    resolved: false,
    suppressRetry: true,
    reversalRequired: false,
    needsReview: true,
    customerMessage: 'We are confirming the status of your payment.',
    suggestedAction:
      'Outcome is overdue. Probe the debit status with your bank/PSP before any retry; it may have already settled.',
  },
  ambiguous: {
    resolved: false,
    suppressRetry: true,
    reversalRequired: false,
    needsReview: true,
    customerMessage: 'We are confirming the status of your payment.',
    suggestedAction:
      'Could not classify safely. Hold automated action and review the attempt/outcome records.',
  },
});

/** The action policy for a reconciliation status. */
export function reconciliationHandlingFor(status: ReconciliationStatus): ReconciliationHandling {
  return RECONCILIATION_HANDLING[status];
}
