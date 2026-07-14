import { describe, expect, it } from 'vitest';
import { AadeshError, getRailProfile, reconcile } from '../src';
import type { DebitAttempt, DebitOutcome } from '../src';

const NOW = new Date('2026-07-14T09:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

// Real dataset codes used below:
//   '0'   = eNACH success
//   '00'  = UPI Autopay success
//   'AP02'= eNACH account_closed (terminal failure)
//   'IE'  = UPI Autopay insufficient funds (retriable failure)

function attempt(over: Partial<DebitAttempt> = {}): DebitAttempt {
  return {
    attemptId: 'a1',
    debitKey: 'd1',
    rail: 'enach',
    amountPaise: 50000,
    attemptNumber: 1,
    presentedAt: hoursAgo(1),
    ...over,
  };
}

function outcome(over: Partial<DebitOutcome> = {}): DebitOutcome {
  return { rail: 'enach', amountPaise: 50000, rawCode: '0', reportedAt: NOW, ...over };
}

describe('reconcile', () => {
  it('settles a clean single-attempt success', () => {
    const r = reconcile({ attempts: [attempt()], outcomes: [outcome({ attemptId: 'a1' })], now: NOW });
    const d = r.debits[0]!;
    expect(d.status).toBe('settled');
    expect(d.handling.resolved).toBe(true);
    expect(d.handling.reversalRequired).toBe(false);
    expect(d.unsettledAttemptIds).toEqual([]);
  });

  it('marks a clean failure as failed, and does NOT suppress a legitimate retry', () => {
    const r = reconcile({
      attempts: [attempt({ rail: 'upi_autopay' })],
      outcomes: [outcome({ attemptId: 'a1', rail: 'upi_autopay', rawCode: 'IE' })],
      now: NOW,
    });
    const d = r.debits[0]!;
    expect(d.status).toBe('failed');
    expect(d.handling.resolved).toBe(true);
    expect(d.handling.suppressRetry).toBe(false);
    expect(r.suppressRetryKeys).not.toContain('d1');
  });

  it('flags the async-return-vs-retry race and suppresses the open retry (the hero case)', () => {
    const attempts = [
      attempt({ attemptId: 'a1', attemptNumber: 1, presentedAt: hoursAgo(30) }),
      attempt({ attemptId: 'a2', attemptNumber: 2, presentedAt: hoursAgo(2) }),
    ];
    // The first attempt's success lands late, after the retry was already presented.
    const r = reconcile({ attempts, outcomes: [outcome({ attemptId: 'a1' })], now: NOW });
    const d = r.debits[0]!;
    expect(d.status).toBe('double_debit_risk');
    expect(d.handling.suppressRetry).toBe(true);
    expect(d.unsettledAttemptIds).toEqual(['a2']);
    expect(r.suppressRetryKeys).toContain('d1');
  });

  it('confirms a double debit when two attempts both settle, and requires a reversal', () => {
    const attempts = [
      attempt({ attemptId: 'a1', attemptNumber: 1 }),
      attempt({ attemptId: 'a2', attemptNumber: 2 }),
    ];
    const outcomes = [outcome({ attemptId: 'a1' }), outcome({ attemptId: 'a2' })];
    const r = reconcile({ attempts, outcomes, now: NOW });
    const d = r.debits[0]!;
    expect(d.status).toBe('double_debit_confirmed');
    expect(d.handling.reversalRequired).toBe(true);
    expect(r.reversalKeys).toContain('d1');
  });

  it('never treats an amount-mismatched success as settled', () => {
    const r = reconcile({
      attempts: [attempt({ amountPaise: 50000 })],
      outcomes: [outcome({ attemptId: 'a1', amountPaise: 49900 })],
      now: NOW,
    });
    const d = r.debits[0]!;
    expect(d.status).toBe('amount_mismatch');
    expect(d.handling.suppressRetry).toBe(true);
    expect(d.handling.needsReview).toBe(true);
  });

  it('is pending within the return window, timed_out past it', () => {
    const pending = reconcile({ attempts: [attempt({ presentedAt: hoursAgo(2) })], outcomes: [], now: NOW });
    expect(pending.debits[0]!.status).toBe('pending');
    expect(pending.debits[0]!.handling.suppressRetry).toBe(false);

    // eNACH return window default is 96h; 120h with no outcome is overdue.
    const stuck = reconcile({ attempts: [attempt({ presentedAt: hoursAgo(120) })], outcomes: [], now: NOW });
    expect(stuck.debits[0]!.status).toBe('timed_out');
    expect(stuck.debits[0]!.handling.suppressRetry).toBe(true);
    expect(stuck.debits[0]!.handling.needsReview).toBe(true);
  });

  it('attributes a debitKey-only outcome (no attemptId) to the open attempt', () => {
    const r = reconcile({ attempts: [attempt()], outcomes: [outcome({ debitKey: 'd1' })], now: NOW });
    expect(r.debits[0]!.status).toBe('settled');
  });

  it('holds an unrecognized outcome code for review rather than guessing', () => {
    const r = reconcile({
      attempts: [attempt()],
      outcomes: [outcome({ attemptId: 'a1', rawCode: 'ZZZ-not-a-code' })],
      now: NOW,
    });
    expect(r.debits[0]!.status).toBe('ambiguous');
    expect(r.debits[0]!.handling.needsReview).toBe(true);
  });

  it('collects outcomes that match no attempt as orphans', () => {
    const r = reconcile({
      attempts: [attempt()],
      outcomes: [outcome({ attemptId: 'a1' }), outcome({ debitKey: 'unknown-debit' })],
      now: NOW,
    });
    expect(r.orphanOutcomes).toHaveLength(1);
    expect(r.orphanOutcomes[0]!.debitKey).toBe('unknown-debit');
  });

  it('rejects malformed input to protect a money decision', () => {
    expect(() => reconcile({ attempts: [attempt({ amountPaise: 100.5 })], outcomes: [] })).toThrow(
      AadeshError,
    );
    expect(() => reconcile({ attempts: [attempt({ amountPaise: -1 })], outcomes: [] })).toThrow(AadeshError);
    expect(() => reconcile({ attempts: [attempt(), attempt()], outcomes: [] })).toThrow(
      /Duplicate attemptId/,
    );
    expect(() =>
      reconcile({
        attempts: [attempt()],
        outcomes: [{ rail: 'enach', amountPaise: 1, rawCode: '0', reportedAt: NOW }],
      }),
    ).toThrow(/attemptId or debitKey/);
  });

  it('exposes a per-rail return window on the rail profile', () => {
    expect(getRailProfile('enach').returnWindowHours).toBe(96);
    expect(getRailProfile('upi_autopay').returnWindowHours).toBe(24);
  });

  it('is deterministic and sorts debits by key', () => {
    const attempts = [
      attempt({ attemptId: 'x', debitKey: 'zzz' }),
      attempt({ attemptId: 'y', debitKey: 'aaa' }),
    ];
    const r = reconcile({ attempts, outcomes: [], now: NOW });
    expect(r.debits.map((d) => d.debitKey)).toEqual(['aaa', 'zzz']);
  });
});
