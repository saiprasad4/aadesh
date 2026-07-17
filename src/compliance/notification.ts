import { AadeshError } from '../errors';
import { getRailProfile } from '../rails';
import type { Rail } from '../types';

/**
 * Pre-debit notification timing, per the RBI Digital Payments E-mandate Framework,
 * 2026: the customer must be notified at least 24 hours before a recurring debit,
 * and the notice must carry the amount, debit date, merchant name, mandate
 * reference and reason. FASTag and NCMC automatic recharges are exempt.
 *
 * The lead time is read from the rail profile, so it stays consistent with the
 * rest of the library rather than being hardcoded here.
 */

/** Debit categories exempt from the pre-debit notification requirement. */
export type NotificationExemptCategory = 'fastag_recharge' | 'ncmc_recharge';

/** The fields a compliant pre-debit notification must carry. */
export const PRE_DEBIT_NOTIFICATION_FIELDS: readonly string[] = Object.freeze([
  'amount',
  'debitDate',
  'merchantName',
  'mandateReference',
  'reason',
]);

function assertValidDate(value: unknown, label: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new AadeshError(`${label} must be a valid Date`);
  }
}

export interface PreDebitNotificationInput {
  readonly rail: Rail;
  /** The scheduled debit instant. */
  readonly debitAt: Date;
  /** Set for auto-recharge debits that are exempt from the notification. */
  readonly exemptCategory?: NotificationExemptCategory;
}

export interface PreDebitNotificationPlan {
  /** Whether a pre-debit notification is required for this debit. */
  readonly required: boolean;
  /** The lead time the notification must precede the debit by, in hours. */
  readonly leadTimeHours: number;
  /** The latest instant the notification may be sent to stay compliant, or null if not required. */
  readonly sendBy: Date | null;
  /** The fields the notification must carry. */
  readonly requiredFields: readonly string[];
}

/** Plan the pre-debit notification for a scheduled debit: whether it is needed and by when. */
export function planPreDebitNotification(input: PreDebitNotificationInput): PreDebitNotificationPlan {
  assertValidDate(input.debitAt, 'debitAt');
  const profile = getRailProfile(input.rail);
  const leadTimeHours = profile.preDebitNotice.leadTimeHours;
  const required = profile.preDebitNotice.required && input.exemptCategory === undefined;

  return {
    required,
    leadTimeHours,
    sendBy: required ? new Date(input.debitAt.getTime() - leadTimeHours * 3600_000) : null,
    requiredFields: PRE_DEBIT_NOTIFICATION_FIELDS,
  };
}

export interface PreDebitNotificationTimelinessInput extends PreDebitNotificationInput {
  /** When the notification was actually sent, or null if it was not sent. */
  readonly notifiedAt: Date | null;
}

/**
 * Whether a notification sent at `notifiedAt` is timely for a debit at `debitAt`.
 * Conservative: if the notification is required and was not sent, or was sent
 * later than the deadline, it is not timely. Exempt debits are always timely.
 */
export function isPreDebitNotificationTimely(input: PreDebitNotificationTimelinessInput): boolean {
  const plan = planPreDebitNotification(input);
  if (!plan.required || plan.sendBy === null) {
    return true;
  }
  if (input.notifiedAt === null) {
    return false;
  }
  assertValidDate(input.notifiedAt, 'notifiedAt');
  return input.notifiedAt.getTime() <= plan.sendBy.getTime();
}
