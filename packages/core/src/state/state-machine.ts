import { RelayState, UsageSnapshot } from '../models/types';

export interface StateMachineConfig {
  armThreshold: number;
  checkpointThreshold: number;
  handoffThreshold: number;
  emergencyThreshold: number;
}

export class RelayStateMachine {
  private currentState: RelayState = 'IDLE';

  constructor(private readonly config: StateMachineConfig) {
    this.validateConfig();
  }

  private validateConfig() {
    const { armThreshold, checkpointThreshold, handoffThreshold, emergencyThreshold } = this.config;
    if (!(0 < armThreshold && armThreshold < checkpointThreshold && checkpointThreshold < handoffThreshold && handoffThreshold < emergencyThreshold && emergencyThreshold <= 100)) {
      throw new Error('Invalid thresholds: Must be 0 < arm < checkpoint < handoff < emergency <= 100');
    }
  }

  getState(): RelayState {
    return this.currentState;
  }

  // Triggered by manual actions or lifecycle hooks
  transition(action: 'MANUAL_CHECKPOINT' | 'MANUAL_HANDOFF' | 'HANDOFF_COMPLETED' | 'RESUME_INITIATED' | 'RESUME_COMPLETED' | 'RESOLVE' | 'RESET'): RelayState {
    switch (action) {
      case 'MANUAL_CHECKPOINT':
        if (this.currentState === 'IDLE' || this.currentState === 'ARMED') {
          this.currentState = 'CHECKPOINTED';
        }
        break;
      case 'MANUAL_HANDOFF':
        this.currentState = 'HANDOFF_IN_PROGRESS';
        break;
      case 'HANDOFF_COMPLETED':
        this.currentState = 'HANDOFF_READY';
        break;
      case 'RESUME_INITIATED':
        if (this.currentState === 'HANDOFF_READY') {
          this.currentState = 'RESUME_PENDING';
        }
        break;
      case 'RESUME_COMPLETED':
        if (this.currentState === 'RESUME_PENDING') {
          this.currentState = 'RESUMED';
        }
        break;
      case 'RESOLVE':
        if (this.currentState === 'RESUMED' || this.currentState === 'HANDOFF_READY') {
          this.currentState = 'RESOLVED';
        }
        break;
      case 'RESET':
        this.currentState = 'IDLE';
        break;
    }
    return this.currentState;
  }

  // Triggered by usage updates
  evaluateUsage(usage: UsageSnapshot): RelayState {
    // If usage is unavailable or we're already in a final/active handoff state, do nothing
    if (usage.contextPercent === null) {
      return this.currentState;
    }

    if (['HANDOFF_IN_PROGRESS', 'HANDOFF_READY', 'RESUME_PENDING', 'RESUMED', 'RESOLVED', 'ERROR'].includes(this.currentState)) {
      return this.currentState;
    }

    const val = usage.contextPercent;

    if (val >= this.config.handoffThreshold) {
      this.currentState = 'HANDOFF_IN_PROGRESS';
    } else if (val >= this.config.checkpointThreshold) {
      this.currentState = 'CHECKPOINTED';
    } else if (val >= this.config.armThreshold) {
      if (this.currentState === 'IDLE') {
        this.currentState = 'ARMED';
      }
    } else {
      // Usage dropped below arm threshold, likely a reset/compaction
      if (this.currentState !== 'IDLE') {
        this.currentState = 'IDLE';
      }
    }

    return this.currentState;
  }
}
