import { describe, expect, it } from 'vitest';
import {
  AadeshError,
  checkDebitLimits,
  debitSchedule,
  isPreDebitNotificationTimely,
  planPreDebitNotification,
  upcomingDebits,
} from '../src/index';

/**
 * Compliance rules from the RBI Digital Payments E-mandate Framework, 2026:
 * the ₹15,000 / ₹1,00,000 AFA ceilings, the 24-hour pre-debit notification, and
 * schedule computation. Amounts are integer paise; ₹15,000 = 1_500_000 paise.
 */

const RUPEE = 100;

describe('checkDebitLimits', () => {
  it('does not require AFA up to the ₹15,000 default ceiling, inclusive', () => {
    const below = checkDebitLimits({ rail: 'upi_autopay', amountPaise: 10_000 * RUPEE });
    expect(below.afaRequired).toBe(false);

    const exactly = checkDebitLimits({ rail: 'upi_autopay', amountPaise: 15_000 * RUPEE });
    expect(exactly.afaRequired).toBe(false);
    expect(exactly.noAfaCeilingPaise).toBe(15_000 * RUPEE);
  });

  it('requires AFA one paise above the default ceiling', () => {
    const check = checkDebitLimits({ rail: 'upi_autopay', amountPaise: 15_000 * RUPEE + 1 });
    expect(check.afaRequired).toBe(true);
    expect(check.flags).toContain('afa_required');
  });

  it('applies the ₹1,00,000 ceiling for an eligible merchant category', () => {
    const insurance = checkDebitLimits({
      rail: 'upi_autopay',
      amountPaise: 50_000 * RUPEE,
      mcc: '6300', // insurance premiums
    });
    expect(insurance.higherCeilingApplied).toBe(true);
    expect(insurance.afaRequired).toBe(false);
    expect(insurance.noAfaCeilingPaise).toBe(100_000 * RUPEE);
    expect(insurance.flags).toContain('higher_ceiling_applied');
  });

  it('requires AFA above the higher ceiling too', () => {
    const check = checkDebitLimits({
      rail: 'upi_autopay',
      amountPaise: 100_000 * RUPEE + 1,
      mcc: '6300',
    });
    expect(check.afaRequired).toBe(true);
  });

  it('keeps the default ceiling for an ineligible MCC', () => {
    const check = checkDebitLimits({ rail: 'upi_autopay', amountPaise: 50_000 * RUPEE, mcc: '1234' });
    expect(check.higherCeilingApplied).toBe(false);
    expect(check.afaRequired).toBe(true);
  });

  it('flags an amount over the mandate maximum', () => {
    const check = checkDebitLimits({
      rail: 'upi_autopay',
      amountPaise: 20_000 * RUPEE,
      mandateMaxAmountPaise: 10_000 * RUPEE,
    });
    expect(check.withinMandateMax).toBe(false);
    expect(check.flags).toContain('exceeds_mandate_max');
  });

  it('applies the same ceilings to eNACH, driven by the rail profile', () => {
    const check = checkDebitLimits({ rail: 'enach', amountPaise: 20_000 * RUPEE });
    expect(check.afaRequired).toBe(true);
    expect(check.noAfaCeilingPaise).toBe(15_000 * RUPEE);
  });

  it('rejects a non-positive or non-integer amount', () => {
    expect(() => checkDebitLimits({ rail: 'upi_autopay', amountPaise: 0 })).toThrow(AadeshError);
    expect(() => checkDebitLimits({ rail: 'upi_autopay', amountPaise: -100 })).toThrow(AadeshError);
    expect(() => checkDebitLimits({ rail: 'upi_autopay', amountPaise: 10.5 })).toThrow(AadeshError);
  });
});

describe('planPreDebitNotification', () => {
  it('requires a notification 24 hours before a UPI Autopay debit', () => {
    const debitAt = new Date('2026-03-15T10:00:00.000Z');
    const plan = planPreDebitNotification({ rail: 'upi_autopay', debitAt });
    expect(plan.required).toBe(true);
    expect(plan.leadTimeHours).toBe(24);
    expect(plan.sendBy?.toISOString()).toBe('2026-03-14T10:00:00.000Z');
    expect(plan.requiredFields).toContain('mandateReference');
    expect(plan.requiredFields).toContain('reason');
  });

  it('exempts FASTag and NCMC auto-recharges', () => {
    const debitAt = new Date('2026-03-15T10:00:00.000Z');
    const fastag = planPreDebitNotification({
      rail: 'upi_autopay',
      debitAt,
      exemptCategory: 'fastag_recharge',
    });
    expect(fastag.required).toBe(false);
    expect(fastag.sendBy).toBeNull();
  });

  it('rejects an invalid debit date', () => {
    expect(() => planPreDebitNotification({ rail: 'upi_autopay', debitAt: new Date('nope') })).toThrow(
      AadeshError,
    );
  });
});

describe('isPreDebitNotificationTimely', () => {
  const debitAt = new Date('2026-03-15T10:00:00.000Z');

  it('accepts a notification sent at or before the 24-hour deadline', () => {
    expect(
      isPreDebitNotificationTimely({
        rail: 'upi_autopay',
        debitAt,
        notifiedAt: new Date('2026-03-14T10:00:00.000Z'),
      }),
    ).toBe(true);
    expect(
      isPreDebitNotificationTimely({
        rail: 'upi_autopay',
        debitAt,
        notifiedAt: new Date('2026-03-13T10:00:00.000Z'),
      }),
    ).toBe(true);
  });

  it('rejects a notification sent inside the 24-hour window', () => {
    expect(
      isPreDebitNotificationTimely({
        rail: 'upi_autopay',
        debitAt,
        notifiedAt: new Date('2026-03-14T11:00:00.000Z'),
      }),
    ).toBe(false);
  });

  it('rejects a required notification that was never sent', () => {
    expect(isPreDebitNotificationTimely({ rail: 'upi_autopay', debitAt, notifiedAt: null })).toBe(false);
  });

  it('treats an exempt debit as always timely', () => {
    expect(
      isPreDebitNotificationTimely({
        rail: 'upi_autopay',
        debitAt,
        notifiedAt: null,
        exemptCategory: 'ncmc_recharge',
      }),
    ).toBe(true);
  });
});

describe('debitSchedule', () => {
  const iso = (dates: Date[]) => dates.map((date) => date.toISOString());

  it('lists monthly debits within the window', () => {
    const dates = debitSchedule(
      { frequency: 'monthly', startDate: new Date('2026-01-15T00:00:00.000Z') },
      { from: new Date('2026-01-01T00:00:00.000Z'), to: new Date('2026-04-30T00:00:00.000Z') },
    );
    expect(iso(dates)).toEqual([
      '2026-01-15T00:00:00.000Z',
      '2026-02-15T00:00:00.000Z',
      '2026-03-15T00:00:00.000Z',
      '2026-04-15T00:00:00.000Z',
    ]);
  });

  it('clamps a day-31 anchor to the last day of shorter months', () => {
    const dates = debitSchedule(
      { frequency: 'monthly', startDate: new Date('2026-01-31T00:00:00.000Z'), dayOfMonth: 31 },
      { from: new Date('2026-01-01T00:00:00.000Z'), to: new Date('2026-03-31T00:00:00.000Z') },
    );
    expect(iso(dates)).toEqual([
      '2026-01-31T00:00:00.000Z',
      '2026-02-28T00:00:00.000Z',
      '2026-03-31T00:00:00.000Z',
    ]);
  });

  it('stops at the mandate end date', () => {
    const dates = debitSchedule(
      {
        frequency: 'monthly',
        startDate: new Date('2026-01-15T00:00:00.000Z'),
        endDate: new Date('2026-02-20T00:00:00.000Z'),
      },
      { from: new Date('2026-01-01T00:00:00.000Z'), to: new Date('2026-12-31T00:00:00.000Z') },
    );
    expect(iso(dates)).toEqual(['2026-01-15T00:00:00.000Z', '2026-02-15T00:00:00.000Z']);
  });

  it('excludes debits before the window start', () => {
    const dates = debitSchedule(
      { frequency: 'monthly', startDate: new Date('2026-01-15T00:00:00.000Z') },
      { from: new Date('2026-03-01T00:00:00.000Z'), to: new Date('2026-04-30T00:00:00.000Z') },
    );
    expect(iso(dates)).toEqual(['2026-03-15T00:00:00.000Z', '2026-04-15T00:00:00.000Z']);
  });

  it('steps quarterly', () => {
    const dates = debitSchedule(
      { frequency: 'quarterly', startDate: new Date('2026-01-10T00:00:00.000Z') },
      { from: new Date('2026-01-01T00:00:00.000Z'), to: new Date('2026-12-31T00:00:00.000Z') },
    );
    expect(iso(dates)).toEqual([
      '2026-01-10T00:00:00.000Z',
      '2026-04-10T00:00:00.000Z',
      '2026-07-10T00:00:00.000Z',
      '2026-10-10T00:00:00.000Z',
    ]);
  });

  it('steps weekly', () => {
    const dates = debitSchedule(
      { frequency: 'weekly', startDate: new Date('2026-01-01T00:00:00.000Z') },
      { from: new Date('2026-01-01T00:00:00.000Z'), to: new Date('2026-01-31T00:00:00.000Z') },
    );
    expect(dates).toHaveLength(5);
    expect(dates[0]?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(dates[4]?.toISOString()).toBe('2026-01-29T00:00:00.000Z');
  });

  it('returns nothing for an as_presented mandate', () => {
    const dates = debitSchedule(
      { frequency: 'as_presented', startDate: new Date('2026-01-15T00:00:00.000Z') },
      { from: new Date('2026-01-01T00:00:00.000Z'), to: new Date('2026-12-31T00:00:00.000Z') },
    );
    expect(dates).toEqual([]);
  });

  it('returns nothing for an inverted window', () => {
    const dates = debitSchedule(
      { frequency: 'monthly', startDate: new Date('2026-01-15T00:00:00.000Z') },
      { from: new Date('2026-04-30T00:00:00.000Z'), to: new Date('2026-01-01T00:00:00.000Z') },
    );
    expect(dates).toEqual([]);
  });

  it('rejects a day-of-month outside 1..31', () => {
    expect(() =>
      debitSchedule(
        { frequency: 'monthly', startDate: new Date('2026-01-15T00:00:00.000Z'), dayOfMonth: 32 },
        { from: new Date('2026-01-01T00:00:00.000Z'), to: new Date('2026-04-30T00:00:00.000Z') },
      ),
    ).toThrow(AadeshError);
  });
});

describe('upcomingDebits', () => {
  it('pairs each debit with its 24-hour notification deadline', () => {
    const result = upcomingDebits(
      { frequency: 'monthly', startDate: new Date('2026-01-15T00:00:00.000Z') },
      { from: new Date('2026-01-01T00:00:00.000Z'), to: new Date('2026-02-28T00:00:00.000Z') },
      'upi_autopay',
    );
    expect(result).toHaveLength(2);
    expect(result[0]?.debitAt.toISOString()).toBe('2026-01-15T00:00:00.000Z');
    expect(result[0]?.notifySendBy?.toISOString()).toBe('2026-01-14T00:00:00.000Z');
  });
});
