import { describe, it, expect } from 'vitest';
import { AgentStateMachine } from '../server/agent/state';

describe('Agent State Machine (Jarvis Phase 2 — WS3)', () => {
  it('follows the happy path: idle → classifying → planning → executing → verifying → done', () => {
    const sm = new AgentStateMachine();
    sm.transition('classifying');
    sm.transition('planning');
    sm.transition('executing');
    sm.transition('verifying');
    sm.recordVerification(true);
    sm.finish('success');
    expect(sm.status).toBe('done');
    expect(sm.isTerminal()).toBe(true);
  });

  it('rejects illegal transitions', () => {
    const sm = new AgentStateMachine();
    expect(() => sm.transition('executing')).toThrow(); // idle → executing not allowed
    sm.transition('classifying');
    expect(() => sm.transition('awaiting_tool_result')).toThrow();
  });

  it('REFUSES success without a passing verification (core Jarvis invariant)', () => {
    const sm = new AgentStateMachine();
    sm.transition('classifying');
    sm.transition('planning');
    sm.transition('executing');
    sm.transition('verifying');
    // No recordVerification(true) — success must be unreachable.
    expect(() => sm.finish('success')).toThrow(/verification/i);
  });

  it('allows success without verification ONLY on the chat fast-path', () => {
    const sm = new AgentStateMachine();
    sm.markChatFastPath();
    sm.transition('classifying');
    sm.transition('executing');
    sm.finish('success');
    expect(sm.status).toBe('done');
  });

  it('a failed verification does not satisfy the invariant', () => {
    const sm = new AgentStateMachine();
    sm.transition('classifying');
    sm.transition('planning');
    sm.transition('executing');
    sm.transition('verifying');
    sm.recordVerification(false);
    expect(() => sm.finish('success')).toThrow();
  });

  it('supports approval and tool-result wait states', () => {
    const sm = new AgentStateMachine();
    sm.transition('classifying');
    sm.transition('planning');
    sm.transition('awaiting_approval');
    sm.transition('executing');
    sm.transition('awaiting_tool_result');
    sm.transition('executing');
    expect(sm.status).toBe('executing');
  });

  it('allows partial outcome without verification', () => {
    const sm = new AgentStateMachine();
    sm.transition('classifying');
    sm.transition('planning');
    sm.transition('executing');
    sm.transition('verifying');
    sm.finish('partial');
    expect(sm.status).toBe('done');
  });

  it('terminal states accept no further transitions', () => {
    const sm = new AgentStateMachine();
    sm.transition('classifying');
    sm.transition('executing');
    sm.transition('failed');
    expect(() => sm.transition('executing')).toThrow();
  });
});
