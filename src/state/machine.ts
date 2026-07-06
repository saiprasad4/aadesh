import { AadeshError, InvalidTransitionError } from '../errors';
import type { DebitState, MandateState } from './states';
import { DEBIT_TRANSITIONS, MANDATE_TRANSITIONS } from './states';

/**
 * A minimal, dependency-free finite state machine over a string-union of states,
 * driven by a total transition table. Attempting an illegal transition throws
 * {@link InvalidTransitionError}... never silently no-ops... so invalid mandate
 * flows surface loudly in tests and logs.
 */
export class StateMachine<S extends string> {
  private _state: S;

  constructor(
    private readonly transitions: Record<S, readonly S[]>,
    initial: S,
  ) {
    if (!(initial in transitions)) {
      throw new AadeshError(`Unknown initial state: "${String(initial)}"`);
    }
    this._state = initial;
  }

  /** The current state. */
  get state(): S {
    return this._state;
  }

  /** Would a transition to `to` be legal from the current state? */
  can(to: S): boolean {
    return this.transitions[this._state].includes(to);
  }

  /** The set of states reachable in one step from the current state. */
  next(): readonly S[] {
    return this.transitions[this._state];
  }

  /** True when no further transitions are possible from the current state. */
  isTerminal(): boolean {
    return this.transitions[this._state].length === 0;
  }

  /**
   * Advance to `to`, or throw {@link InvalidTransitionError} if illegal.
   * Returns the new current state.
   */
  transition(to: S): S {
    if (!this.can(to)) {
      throw new InvalidTransitionError(this._state, to);
    }
    this._state = to;
    return this._state;
  }
}

/** The registration lifecycle of a mandate. Starts at `created`. */
export class MandateMachine extends StateMachine<MandateState> {
  constructor(initial: MandateState = 'created') {
    super(MANDATE_TRANSITIONS, initial);
  }
}

/** The lifecycle of a single debit attempt. Starts at `scheduled`. */
export class DebitMachine extends StateMachine<DebitState> {
  constructor(initial: DebitState = 'scheduled') {
    super(DEBIT_TRANSITIONS, initial);
  }
}
