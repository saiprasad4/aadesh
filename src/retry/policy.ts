import { getErrorCode } from '../codes';
import { AadeshError } from '../errors';
import { getRailProfile } from '../rails';
import type { Rail } from '../types';

/** Inputs for a retry decision on a failed debit. */
export interface RetryContext {
  rail: Rail;
  /** Debit attempts already made this cycle, including the original. Must be an integer >= 1. */
  attemptsSoFar: number;
  /** The raw failure code, if one was returned. */
  errorCode?: string;
  /** Injectable clock for deterministic scheduling. Defaults to `new Date()`. */
  now?: Date;
}

/** The outcome of {@link decideRetry}. */
export interface RetryDecision {
  /** Should the debit be retried? */
  retry: boolean;
  /** Human-readable justification, safe for logs. */
  reason: string;
  /** Attempts still permitted **after** the one this decision authorizes. `0` whenever `retry` is false. */
  attemptsRemaining: number;
  /** Earliest time the next attempt should be scheduled, when `retry` is true. */
  notBefore?: Date;
}

/**
 * Decide whether a failed recurring debit should be retried, and when.
 *
 * The policy is conservative for money... it will not automate a retry it cannot
 * justify:
 *  1. **Success**... a success/approval code returns `retry:false` (nothing to do).
 *  2. **Terminal / non-retriable**... dead mandate or a code marked unsafe to
 *     retry stops immediately.
 *  3. **Unrecognized code**... a code that isn't in the dataset is NOT retried
 *     (we refuse to guess with money); it's flagged for review.
 *  4. **Attempt cap**... the rail's `maxDebitAttempts` (e.g. UPI Autopay 1+3)
 *     bounds the total tries.
 *  5. **Spacing**... a retriable failure is scheduled no sooner than the rail's
 *     `minRetryGapHours` from now.
 *
 * Passing no `errorCode` means "a generic failure with no code" and is retried
 * within the cap; passing an *unrecognized* code is treated conservatively (no
 * retry). Throws {@link AadeshError} if `attemptsSoFar` is not an integer >= 1.
 */
export function decideRetry(ctx: RetryContext): RetryDecision {
  if (!Number.isInteger(ctx.attemptsSoFar) || ctx.attemptsSoFar < 1) {
    throw new AadeshError(
      `decideRetry: attemptsSoFar must be an integer >= 1 (the original attempt counts as 1); got ${ctx.attemptsSoFar}`,
    );
  }

  const profile = getRailProfile(ctx.rail);
  const stop = (reason: string): RetryDecision => ({ retry: false, reason, attemptsRemaining: 0 });

  if (ctx.errorCode !== undefined) {
    const resolved = getErrorCode(ctx.errorCode, { rail: ctx.rail });
    if (resolved === undefined) {
      return stop(
        `Unrecognized code "${ctx.errorCode}"... not auto-retried. Classify it before retrying (needs review).`,
      );
    }
    if (resolved.category === 'success') {
      return stop('Success code... the debit already succeeded; nothing to retry.');
    }
    if (resolved.terminal) {
      return stop(`Terminal error (${resolved.category}): the mandate is dead and must be re-registered.`);
    }
    if (!resolved.retriable) {
      return stop(`Non-retriable error (${resolved.category}): ${resolved.suggestedAction}`);
    }
  }

  if (profile.maxDebitAttempts - ctx.attemptsSoFar <= 0) {
    return stop(`Retry cap reached (${profile.maxDebitAttempts} attempts max on ${profile.displayName}).`);
  }

  const now = ctx.now ?? new Date();
  const notBefore = new Date(now.getTime() + profile.minRetryGapHours * 60 * 60 * 1000);
  const attemptsRemaining = Math.max(0, profile.maxDebitAttempts - ctx.attemptsSoFar - 1);
  return {
    retry: true,
    reason:
      ctx.errorCode === undefined
        ? 'No error code supplied; retrying within the attempt cap.'
        : 'Retriable failure within the attempt cap.',
    attemptsRemaining,
    notBefore,
  };
}
