/** Base class for all errors thrown by aadesh. */
export class AadeshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AadeshError';
    // Restore the prototype chain for consumers that down-compile to ES5,
    // so `instanceof` keeps working across the extends boundary.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when an illegal state transition is attempted on a mandate/debit machine. */
export class InvalidTransitionError extends AadeshError {
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Invalid state transition: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown by {@link getErrorCode} when a bare code is looked up without a `rail`
 * but exists on more than one rail with different meanings. Ambiguity is loud by
 * design: silently guessing the wrong rail could invert a money decision.
 */
export class AmbiguousCodeError extends AadeshError {
  constructor(
    public readonly code: string,
    public readonly rails: readonly string[],
  ) {
    super(
      `Code "${code}" exists on multiple rails (${rails.join(', ')}) with different meanings. Pass { rail } to disambiguate.`,
    );
    this.name = 'AmbiguousCodeError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
