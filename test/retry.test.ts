import { describe, expect, it } from 'vitest';
import { AadeshError, decideRetry, getRailProfile } from '../src';

const NOW = new Date('2026-07-01T09:00:00.000Z');

// Real dataset codes:
//   IE   = UPI Autopay, insufficient funds (retriable)
//   AP02 = eNACH, account closed (terminal)
//   59   = eNACH, CBS network failure (retriable) / UPI, suspected fraud (terminal)
//   Z6   = UPI, OTP lockout (authentication_locked, non-retriable)
//   00   = success
describe('decideRetry', () => {
  it('retries a transient failure within the cap and schedules ahead', () => {
    const d = decideRetry({ rail: 'upi_autopay', attemptsSoFar: 1, errorCode: 'IE', now: NOW });
    expect(d.retry).toBe(true);
    // UPI cap = 4; after authorizing this retry (attempt 2), 2 remain.
    expect(d.attemptsRemaining).toBe(2);
    expect(d.notBefore!.getTime()).toBe(NOW.getTime() + 60 * 60 * 1000);
  });

  it('stops on a terminal error, 0 remaining', () => {
    const d = decideRetry({ rail: 'enach', attemptsSoFar: 1, errorCode: 'AP02', now: NOW });
    expect(d.retry).toBe(false);
    expect(d.attemptsRemaining).toBe(0);
    expect(d.reason).toMatch(/terminal/i);
  });

  it('NEVER retries a suspected-fraud decline (UPI 59)... the top money-risk', () => {
    const d = decideRetry({ rail: 'upi_autopay', attemptsSoFar: 1, errorCode: '59', now: NOW });
    expect(d.retry).toBe(false);
    expect(d.attemptsRemaining).toBe(0);
  });

  it('does NOT auto-retry an OTP lockout (Z6)', () => {
    const d = decideRetry({ rail: 'upi_autopay', attemptsSoFar: 1, errorCode: 'Z6', now: NOW });
    expect(d.retry).toBe(false);
    expect(d.reason).toMatch(/non-retriable/i);
  });

  it('short-circuits a success code... nothing to retry', () => {
    const d = decideRetry({ rail: 'enach', attemptsSoFar: 1, errorCode: '0', now: NOW });
    expect(d.retry).toBe(false);
    expect(d.reason).toMatch(/success/i);
  });

  it('does NOT auto-retry an unrecognized code (refuses to guess with money)', () => {
    const d = decideRetry({ rail: 'upi_autopay', attemptsSoFar: 1, errorCode: 'ZZZ-unknown', now: NOW });
    expect(d.retry).toBe(false);
    expect(d.reason).toMatch(/unrecognized|review/i);
  });

  it('honours the UPI Autopay 1+3 attempt cap', () => {
    const d = decideRetry({ rail: 'upi_autopay', attemptsSoFar: 4, errorCode: 'IE', now: NOW });
    expect(d.retry).toBe(false);
    expect(d.reason).toMatch(/cap/i);
  });

  it('authorizes exactly the last permitted attempt (0 remaining after)', () => {
    const d = decideRetry({ rail: 'upi_autopay', attemptsSoFar: 3, errorCode: 'IE', now: NOW });
    expect(d.retry).toBe(true);
    expect(d.attemptsRemaining).toBe(0);
  });

  it('spaces eNACH retries at least a day out', () => {
    const d = decideRetry({ rail: 'enach', attemptsSoFar: 1, errorCode: '59', now: NOW });
    expect(d.retry).toBe(true);
    expect(d.notBefore!.getTime()).toBe(NOW.getTime() + 24 * 60 * 60 * 1000);
  });

  it('retries a generic (no-code) failure within the cap', () => {
    const d = decideRetry({ rail: 'upi_autopay', attemptsSoFar: 1, now: NOW });
    expect(d.retry).toBe(true);
    expect(d.reason).toMatch(/no error code/i);
  });

  it('rejects an invalid attemptsSoFar (guards against an extra debit)', () => {
    expect(() => decideRetry({ rail: 'upi_autopay', attemptsSoFar: 0 })).toThrow(AadeshError);
    expect(() => decideRetry({ rail: 'upi_autopay', attemptsSoFar: 1.5 })).toThrow(AadeshError);
  });

  it('rail caps are the exact documented literals', () => {
    expect(getRailProfile('upi_autopay').maxDebitAttempts).toBe(4);
    expect(getRailProfile('enach').maxDebitAttempts).toBe(3);
    expect(getRailProfile('enach').maxDebitAttemptsVerified).toBe(false);
  });
});
