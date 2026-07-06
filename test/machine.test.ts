import { describe, expect, it } from 'vitest';
import {
  AadeshError,
  DEBIT_TRANSITIONS,
  DebitMachine,
  InvalidTransitionError,
  MANDATE_TRANSITIONS,
  MandateMachine,
  TERMINAL_DEBIT_STATES,
  TERMINAL_MANDATE_STATES,
} from '../src';

describe('MandateMachine', () => {
  it('walks the happy path created → active', () => {
    const m = new MandateMachine();
    expect(m.state).toBe('created');
    m.transition('pending_authentication');
    m.transition('pending_registration');
    m.transition('active');
    expect(m.state).toBe('active');
    expect(m.isTerminal()).toBe(false);
  });

  it('throws on an illegal transition', () => {
    const m = new MandateMachine();
    expect(() => m.transition('active')).toThrow(InvalidTransitionError);
  });

  it('throws on an unknown initial state', () => {
    // @ts-expect-error... deliberately invalid state to prove the guard
    expect(() => new MandateMachine('nonsense')).toThrow(AadeshError);
  });

  it('reports terminal states as terminal', () => {
    expect(new MandateMachine('revoked').isTerminal()).toBe(true);
    for (const s of TERMINAL_MANDATE_STATES) {
      expect(MANDATE_TRANSITIONS[s].length).toBe(0);
    }
  });

  it('allows pause → resume and pause → completed', () => {
    const m = new MandateMachine('active');
    m.transition('paused');
    expect(m.can('active')).toBe(true);
    expect(m.can('completed')).toBe(true);
  });
});

describe('DebitMachine', () => {
  it('requires notification before executing (mandatory 24h pre-debit notice)', () => {
    const d = new DebitMachine();
    expect(d.state).toBe('scheduled');
    expect(d.can('executing')).toBe(false); // cannot bypass notified
    d.transition('notified');
    d.transition('executing');
    d.transition('succeeded');
    expect(d.state).toBe('succeeded');
    expect(d.isTerminal()).toBe(true);
  });

  it('supports a failed → retry_scheduled → notified → executing loop', () => {
    const d = new DebitMachine('executing');
    d.transition('failed');
    d.transition('retry_scheduled');
    expect(d.can('executing')).toBe(false); // retry must be re-notified
    d.transition('notified');
    d.transition('executing');
    expect(d.state).toBe('executing');
  });

  it('can exhaust retries into a terminal failed state', () => {
    const d = new DebitMachine('failed');
    d.transition('exhausted');
    expect(d.isTerminal()).toBe(true);
    for (const s of TERMINAL_DEBIT_STATES) {
      expect(DEBIT_TRANSITIONS[s].length).toBe(0);
    }
  });

  it('cannot resurrect a succeeded debit', () => {
    const d = new DebitMachine('succeeded');
    expect(() => d.transition('executing')).toThrow(InvalidTransitionError);
  });
});
