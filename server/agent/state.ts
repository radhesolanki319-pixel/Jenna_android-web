/**
 * Agent run state machine.
 * Enforces legal transitions — notably: `done` with outcome 'success' is
 * unreachable unless a passing verification was recorded (or the run is a
 * chat fast-path). The agent can never claim success without evidence.
 */

import { AgentRunStatus, AgentRunOutcome } from '../../src/core/agent/eventTypes';

const TRANSITIONS: Record<AgentRunStatus, AgentRunStatus[]> = {
  idle: ['classifying', 'cancelled', 'failed'],
  classifying: ['planning', 'executing', 'done', 'failed', 'cancelled'],
  planning: ['awaiting_approval', 'executing', 'failed', 'cancelled'],
  awaiting_approval: ['executing', 'failed', 'cancelled'],
  executing: ['awaiting_tool_result', 'awaiting_approval', 'verifying', 'done', 'failed', 'cancelled'],
  awaiting_tool_result: ['executing', 'failed', 'cancelled'],
  verifying: ['executing', 'done', 'failed', 'cancelled'],
  done: [],
  failed: [],
  cancelled: [],
};

export class AgentStateMachine {
  private current: AgentRunStatus = 'idle';
  private verificationPassed = false;
  private isChatFastPath = false;

  get status(): AgentRunStatus {
    return this.current;
  }

  markChatFastPath(): void {
    this.isChatFastPath = true;
  }

  recordVerification(passed: boolean): void {
    if (passed) this.verificationPassed = true;
  }

  canTransition(to: AgentRunStatus): boolean {
    return TRANSITIONS[this.current].includes(to);
  }

  transition(to: AgentRunStatus): void {
    if (!this.canTransition(to)) {
      throw new Error(`Illegal agent state transition: ${this.current} → ${to}`);
    }
    this.current = to;
  }

  /**
   * Guarded terminal transition. Success REQUIRES verification evidence
   * unless this run is a plain chat fast-path.
   */
  finish(outcome: AgentRunOutcome): void {
    if (outcome === 'success' && !this.isChatFastPath && !this.verificationPassed) {
      throw new Error(
        'Refusing to finish with outcome "success": no passing verification was recorded.'
      );
    }
    this.transition(outcome === 'success' || outcome === 'partial' ? 'done' : 'failed');
  }

  isTerminal(): boolean {
    return this.current === 'done' || this.current === 'failed' || this.current === 'cancelled';
  }
}
