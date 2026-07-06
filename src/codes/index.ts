import { AmbiguousCodeError } from '../errors';
import type { CategoryHandling, ErrorCategory, MandateErrorCode, Rail, RawErrorCode } from '../types';
import { DATASET_META, RAW_ERROR_CODES } from './data';
import { CATEGORY_HANDLING } from './handling';

export { CATEGORY_HANDLING } from './handling';
export { DATASET_META } from './data';

/** Merge a raw dataset entry with its category handling into a resolved code. */
function resolve(raw: RawErrorCode): MandateErrorCode {
  return { ...raw, ...CATEGORY_HANDLING[raw.category] };
}

// Index raw codes by upper-cased code string; a code may collide across rails.
const index = new Map<string, RawErrorCode[]>();
for (const raw of RAW_ERROR_CODES) {
  const key = raw.code.toUpperCase();
  const bucket = index.get(key);
  if (bucket) {
    bucket.push(raw);
  } else {
    index.set(key, [raw]);
  }
}

/** Options for narrowing an error-code lookup. */
export interface LookupOptions {
  /** The rail the code arrived on. Required to disambiguate cross-rail collisions. */
  rail?: Rail;
}

/**
 * Resolve a raw bank/NPCI/PSP code to its normalized handling, or `undefined` if
 * the code is not in the dataset.
 *
 * Some codes exist on both rails with **different** meanings (e.g. `59` is a CBS
 * network failure on eNACH but a suspected-fraud decline on UPI). For those,
 * pass `{ rail }`. If a bare colliding code is looked up without a rail, this
 * throws {@link AmbiguousCodeError} rather than silently guessing... a wrong
 * guess could invert a money decision.
 */
export function getErrorCode(code: string, opts: LookupOptions = {}): MandateErrorCode | undefined {
  const matches = index.get(code.toUpperCase());
  if (!matches || matches.length === 0) return undefined;

  if (opts.rail !== undefined) {
    const scoped = matches.find((m) => m.rail === opts.rail);
    return scoped ? resolve(scoped) : undefined;
  }

  if (matches.length > 1) {
    throw new AmbiguousCodeError(
      code,
      matches.map((m) => m.rail),
    );
  }
  // Exactly one match and no rail given... safe to resolve.
  return resolve(matches[0]!);
}

/** The authoritative handling policy for a normalized category. */
export function handlingFor(category: ErrorCategory): CategoryHandling {
  return CATEGORY_HANDLING[category];
}

/**
 * Whether a raw code is safe to retry automatically. Returns `undefined` if the
 * code is unknown... an explicit "we don't know", distinct from `false`. Pass
 * `{ rail }` for codes that collide across rails.
 */
export function isRetriable(code: string, opts: LookupOptions = {}): boolean | undefined {
  return getErrorCode(code, opts)?.retriable;
}

/**
 * Whether a raw code means the mandate is dead (must be re-registered). Returns
 * `undefined` if the code is unknown. Pass `{ rail }` for colliding codes.
 */
export function isTerminal(code: string, opts: LookupOptions = {}): boolean | undefined {
  return getErrorCode(code, opts)?.terminal;
}

/** Every code in the dataset, fully resolved. */
export function allErrorCodes(): MandateErrorCode[] {
  return RAW_ERROR_CODES.map(resolve);
}

/** Number of codes in the dataset. */
export function errorCodeCount(): number {
  return RAW_ERROR_CODES.length;
}
