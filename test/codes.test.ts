import { describe, expect, it } from 'vitest';
import {
  AmbiguousCodeError,
  CATEGORY_HANDLING,
  allErrorCodes,
  errorCodeCount,
  getErrorCode,
  handlingFor,
  isRetriable,
  isTerminal,
} from '../src';

describe('error-code dictionary', () => {
  it('resolves a real UPI code and merges category handling (IE = insufficient funds)', () => {
    const ec = getErrorCode('IE', { rail: 'upi_autopay' });
    expect(ec?.category).toBe('insufficient_funds');
    expect(ec?.retriable).toBe(true);
    expect(ec?.terminal).toBe(false);
    expect(ec?.customerMessage.length).toBeGreaterThan(0);
    expect(ec?.suggestedAction.length).toBeGreaterThan(0);
    expect(ec?.verified).toBe(true);
  });

  it('treats account-closed (eNACH AP02) as terminal and non-retriable', () => {
    const ec = getErrorCode('AP02', { rail: 'enach' });
    expect(ec?.category).toBe('account_closed');
    expect(ec?.terminal).toBe(true);
    expect(ec?.retriable).toBe(false);
  });

  it('classifies a SUCCESS code as success... never as a failure (regression: the dictionary must not lie)', () => {
    const ec = getErrorCode('00'); // NPCI success
    expect(ec?.category).toBe('success');
    expect(ec?.retriable).toBe(false);
    expect(ec?.terminal).toBe(false);
    expect(ec?.customerMessage).toMatch(/success/i);
    expect(ec?.customerMessage).not.toMatch(/could not|failed/i);
  });

  it('flags suspected fraud (UPI 59) as terminal and never retriable', () => {
    const ec = getErrorCode('59', { rail: 'upi_autopay' });
    expect(ec?.category).toBe('suspected_fraud');
    expect(ec?.retriable).toBe(false);
    expect(ec?.terminal).toBe(true);
  });

  it('flags permanent restrictions (UPI YC) as not_permitted + terminal', () => {
    const ec = getErrorCode('YC');
    expect(ec?.category).toBe('not_permitted');
    expect(ec?.retriable).toBe(false);
    expect(ec?.terminal).toBe(true);
  });

  it('flags OTP lockout (UPI Z6) as authentication_locked and NOT retriable', () => {
    const ec = getErrorCode('Z6');
    expect(ec?.category).toBe('authentication_locked');
    expect(ec?.retriable).toBe(false);
    expect(ec?.terminal).toBe(false);
  });

  it('throws on an ambiguous cross-rail code with no rail, resolves with one', () => {
    expect(() => getErrorCode('59')).toThrow(AmbiguousCodeError);
    expect(getErrorCode('59', { rail: 'enach' })?.category).toBe('bank_offline');
    expect(getErrorCode('59', { rail: 'upi_autopay' })?.category).toBe('suspected_fraud');
  });

  it('returns undefined for an unknown code (not a false negative)', () => {
    expect(getErrorCode('definitely-not-a-real-code')).toBeUndefined();
    expect(isRetriable('definitely-not-a-real-code')).toBeUndefined();
    expect(isTerminal('definitely-not-a-real-code')).toBeUndefined();
  });

  it('returns undefined when a rail is given but the code is not on that rail', () => {
    expect(getErrorCode('AP02', { rail: 'upi_autopay' })).toBeUndefined();
  });

  it('is case-insensitive on the raw code', () => {
    expect(getErrorCode('ap02', { rail: 'enach' })?.category).toBe('account_closed');
  });

  it('handlingFor() returns the authoritative handling for a category', () => {
    expect(handlingFor('insufficient_funds')).toEqual(CATEGORY_HANDLING.insufficient_funds);
  });

  it('exposes retriable/terminal helpers consistent with the resolved code', () => {
    expect(isRetriable('59', { rail: 'enach' })).toBe(true); // bank_offline
    expect(isTerminal('61', { rail: 'enach' })).toBe(true); // mandate cancelled
  });

  it('every code has non-empty messaging via its category', () => {
    for (const ec of allErrorCodes()) {
      expect(ec.customerMessage.length).toBeGreaterThan(0);
      expect(ec.suggestedAction.length).toBeGreaterThan(0);
      expect(CATEGORY_HANDLING[ec.category]).toBeDefined();
    }
    expect(errorCodeCount()).toBeGreaterThan(200);
  });

  it('the verified flag actually discriminates (authoritative vs vendor-string)', () => {
    const all = allErrorCodes();
    expect(all.some((e) => e.verified)).toBe(true);
    expect(all.some((e) => !e.verified)).toBe(true);
  });
});
