import { describe, it, expect, beforeEach } from 'vitest';
import { RelayStateMachine } from '../src/state/state-machine';
import { UsageSnapshot } from '../src/models/types';

describe('RelayStateMachine', () => {
  let machine: RelayStateMachine;

  beforeEach(() => {
    machine = new RelayStateMachine({
      armThreshold: 90,
      checkpointThreshold: 95,
      handoffThreshold: 97,
      emergencyThreshold: 99
    });
  });

  it('starts in IDLE state', () => {
    expect(machine.getState()).toBe('IDLE');
  });

  it('transitions to ARMED when usage reaches 90', () => {
    const usage: UsageSnapshot = { contextPercent: 90, fiveHourPercent: null, provider: 'mock' };
    expect(machine.evaluateUsage(usage)).toBe('ARMED');
  });

  it('transitions to CHECKPOINTED when usage reaches 95', () => {
    const usage: UsageSnapshot = { contextPercent: 95, fiveHourPercent: null, provider: 'mock' };
    expect(machine.evaluateUsage(usage)).toBe('CHECKPOINTED');
  });

  it('transitions to HANDOFF_IN_PROGRESS when usage reaches 97', () => {
    const usage: UsageSnapshot = { contextPercent: 98, fiveHourPercent: null, provider: 'mock' };
    expect(machine.evaluateUsage(usage)).toBe('HANDOFF_IN_PROGRESS');
  });

  it('handles manual checkpoint properly', () => {
    machine.transition('MANUAL_CHECKPOINT');
    expect(machine.getState()).toBe('CHECKPOINTED');
  });

  it('does not allow transition to IDLE if usage drops but we are in HANDOFF_READY', () => {
    machine.transition('MANUAL_HANDOFF');
    machine.transition('HANDOFF_COMPLETED');
    expect(machine.getState()).toBe('HANDOFF_READY');

    const usage: UsageSnapshot = { contextPercent: 50, fiveHourPercent: null, provider: 'mock' };
    expect(machine.evaluateUsage(usage)).toBe('HANDOFF_READY');
  });

  it('throws error on invalid thresholds', () => {
    expect(() => new RelayStateMachine({
      armThreshold: 95,
      checkpointThreshold: 90, // Invalid ordering
      handoffThreshold: 97,
      emergencyThreshold: 99
    })).toThrowError(/Invalid thresholds/);
  });
});
