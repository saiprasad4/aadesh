import { AadeshError } from '../errors';
import type { Rail } from '../types';
import { planPreDebitNotification } from './notification';

/**
 * Debit-schedule computation for a recurring mandate. Given the mandate terms and
 * a window, it returns the debit dates that fall inside the window, clamped to the
 * mandate's validity. Month arithmetic clamps an out-of-range anchor day to the
 * last day of the month (so a "31st" mandate debits on the 28th/29th in February),
 * which is the common presentation convention.
 *
 * `as_presented` mandates (variable, merchant-initiated) have no deterministic
 * schedule, so they return an empty list... you cannot precompute them.
 *
 * All arithmetic is in UTC to keep results stable regardless of the host timezone.
 */

export type DebitFrequency =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'half_yearly'
  | 'yearly'
  | 'as_presented';

export interface MandateTerms {
  readonly frequency: DebitFrequency;
  /** First debit date of the mandate. */
  readonly startDate: Date;
  /** Last date the mandate is valid, inclusive. Open-ended if omitted. */
  readonly endDate?: Date;
  /**
   * Day-of-month anchor (1..31) for monthly and longer frequencies. Defaults to
   * the day of `startDate`. Clamped to the last day of a shorter month.
   */
  readonly dayOfMonth?: number;
}

export interface DateWindow {
  readonly from: Date;
  readonly to: Date;
}

const MONTH_STEP: Partial<Record<DebitFrequency, number>> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  yearly: 12,
};

const DAY_STEP: Partial<Record<DebitFrequency, number>> = {
  daily: 1,
  weekly: 7,
};

// A generous cap so a misconfigured window can never spin forever.
const MAX_OCCURRENCES = 10_000;

function assertValidDate(value: unknown, label: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new AadeshError(`${label} must be a valid Date`);
  }
}

function daysInMonthUtc(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addMonthsClamped(base: Date, months: number, dayOfMonth: number): Date {
  const absoluteMonth = base.getUTCMonth() + months;
  const targetYear = base.getUTCFullYear() + Math.floor(absoluteMonth / 12);
  const targetMonth = ((absoluteMonth % 12) + 12) % 12;
  const day = Math.min(dayOfMonth, daysInMonthUtc(targetYear, targetMonth));
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds(),
      base.getUTCMilliseconds(),
    ),
  );
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 86_400_000);
}

/** The debit dates that fall within `window`, clamped to the mandate's validity. */
export function debitSchedule(terms: MandateTerms, window: DateWindow): Date[] {
  assertValidDate(terms.startDate, 'startDate');
  assertValidDate(window.from, 'window.from');
  assertValidDate(window.to, 'window.to');
  if (terms.endDate !== undefined) {
    assertValidDate(terms.endDate, 'endDate');
  }
  if (terms.dayOfMonth !== undefined && (terms.dayOfMonth < 1 || terms.dayOfMonth > 31)) {
    throw new AadeshError(`dayOfMonth must be between 1 and 31; got ${terms.dayOfMonth}`);
  }

  if (terms.frequency === 'as_presented' || window.to.getTime() < window.from.getTime()) {
    return [];
  }

  const lastValid =
    terms.endDate !== undefined && terms.endDate.getTime() < window.to.getTime() ? terms.endDate : window.to;

  const monthStep = MONTH_STEP[terms.frequency];
  if (monthStep !== undefined) {
    return monthlyOccurrences(terms, window.from, lastValid, monthStep);
  }

  const dayStep = DAY_STEP[terms.frequency];
  if (dayStep !== undefined) {
    return dailyOccurrences(terms.startDate, window.from, lastValid, dayStep);
  }

  return [];
}

function monthlyOccurrences(
  terms: MandateTerms,
  windowFrom: Date,
  lastValid: Date,
  monthStep: number,
): Date[] {
  const anchorDay = terms.dayOfMonth ?? terms.startDate.getUTCDate();
  const occurrences: Date[] = [];
  for (let index = 0; index < MAX_OCCURRENCES; index++) {
    const occurrence = addMonthsClamped(terms.startDate, index * monthStep, anchorDay);
    if (occurrence.getTime() > lastValid.getTime()) {
      break;
    }
    if (occurrence.getTime() >= windowFrom.getTime() && occurrence.getTime() >= terms.startDate.getTime()) {
      occurrences.push(occurrence);
    }
  }
  return occurrences;
}

function dailyOccurrences(startDate: Date, windowFrom: Date, lastValid: Date, dayStep: number): Date[] {
  const occurrences: Date[] = [];
  let occurrence = startDate;
  for (let count = 0; count < MAX_OCCURRENCES; count++) {
    if (occurrence.getTime() > lastValid.getTime()) {
      break;
    }
    if (occurrence.getTime() >= windowFrom.getTime()) {
      occurrences.push(occurrence);
    }
    occurrence = addDays(occurrence, dayStep);
  }
  return occurrences;
}

export interface UpcomingDebit {
  readonly debitAt: Date;
  /** The latest instant the pre-debit notification may be sent, or null if exempt/not required. */
  readonly notifySendBy: Date | null;
}

/**
 * The upcoming debits in a window, each paired with its pre-debit notification
 * deadline. This is the whole flow in one call: schedule the debits, then work
 * back to when each customer must be notified.
 */
export function upcomingDebits(terms: MandateTerms, window: DateWindow, rail: Rail): UpcomingDebit[] {
  return debitSchedule(terms, window).map((debitAt) => ({
    debitAt,
    notifySendBy: planPreDebitNotification({ rail, debitAt }).sendBy,
  }));
}
