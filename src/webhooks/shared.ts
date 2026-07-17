import { getErrorCode } from '../codes';
import type { MandateErrorCode, Rail } from '../types';

/** Small, defensive readers for untyped provider JSON, so the adapters stay readable. */

export function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function readString(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key];
  if (typeof value === 'string') {
    return value;
  }
  return typeof value === 'number' ? String(value) : undefined;
}

export function readNumber(source: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = source?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Razorpay amounts are already integer paise. Accept only a clean integer. */
export function paiseFromInteger(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) ? value : undefined;
}

/**
 * Cashfree amounts are rupees as a float (e.g. 1000.50). Convert to integer paise
 * by rounding to the nearest paise, which is exact for the two-decimal amounts a
 * PSP actually sends.
 */
export function paiseFromRupees(value: number | undefined): number | undefined {
  return value !== undefined ? Math.round(value * 100) : undefined;
}

/**
 * Resolve a raw provider/bank code through the aadesh dataset, best-effort. Returns
 * undefined when the code is unknown, or when it is ambiguous across rails and no
 * rail is known... never throws, so normalization stays total.
 */
export function resolveErrorCode(
  code: string | undefined,
  rail: Rail | undefined,
): MandateErrorCode | undefined {
  if (!code) {
    return undefined;
  }
  try {
    return getErrorCode(code, rail !== undefined ? { rail } : {});
  } catch {
    return undefined;
  }
}
