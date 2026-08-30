import { describe, it, expect } from 'vitest';
import {
  buildJennaSystemPrompt,
  extractHeuristicTitle,
  estimateTokens,
  optimizeConversationContext,
} from '../src/core/promptBuilder';

describe('Jenna Prompt Builder & Context Optimizer (Phase 1 Foundation)', () => {
  describe('buildJennaSystemPrompt', () => {
    it('should inject core Jenna identity, behavioral tenets, and multilingual instructions', () => {
      const prompt = buildJennaSystemPrompt({});
      expect(prompt).toContain('You are Jenna');
      expect(prompt).toContain('CORE IDENTITY & BEHAVIORAL TENETS');
      expect(prompt).toContain('MULTILINGUAL & HINGLISH');
      expect(prompt).toContain('Roman Hindi');
      expect(prompt).toContain('ADAPTIVE CONVERSATIONAL MODES');
    });

    it('should dynamically inject user profile name, handle, and tone directives', () => {
      const prompt = buildJennaSystemPrompt({
        userProfile: {
          name: 'Sarah Connor',
          handle: '@sarah',
          preferredTone: 'direct_concise',
          customInstructions: 'Always show TypeScript types.',
        },
      });

      expect(prompt).toContain('**Name**: Sarah Connor');
      expect(prompt).toContain('**Handle**: @sarah');
      expect(prompt).toContain('Adopt a crisp, highly efficient, and direct tone');
      expect(prompt).toContain('**Custom User Guidelines**: Always show TypeScript types.');
    });

    it('should seamlessly inject long-term memories into context', () => {
      const prompt = buildJennaSystemPrompt({
        injectedMemories: [
          { category: 'work_context', fact: 'User is architecting an offline-first mobile app' },
          { category: 'preferences', fact: 'User prefers functional programming over OOP' },
        ],
      });

      expect(prompt).toContain('[JENNA LONG-TERM MEMORY CONTEXT]');
      expect(prompt).toContain('[work_context]: User is architecting an offline-first mobile app');
      expect(prompt).toContain('[preferences]: User prefers functional programming over OOP');
    });
  });

  describe('extractHeuristicTitle', () => {
    it('should generate crisp 3-5 word titles removing conversational filler', () => {
      expect(extractHeuristicTitle('Please explain quantum computing simply to me')).toBe(
        'Explain quantum computing simply to'
      );
      expect(extractHeuristicTitle('How do I build a Docker container for Node.js?')).toBe(
        'Build a Docker container for'
      );
      expect(extractHeuristicTitle('Tell me about Roman architecture in 200 BC')).toBe(
        'Roman architecture in 200 BC'
      );
      expect(extractHeuristicTitle('')).toBe('New Conversation');
    });
  });

  describe('estimateTokens', () => {
    it('should accurately calculate ~4 chars/token heuristic', () => {
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens('abcd')).toBe(1);
      expect(estimateTokens('Hello world! How are you doing today?')).toBe(Math.ceil(37 / 4));
    });
  });

  describe('optimizeConversationContext', () => {
    it('should preserve single turn as-is', () => {
      const turns = [{ role: 'user' as const, content: 'Hello' }];
      const optimized = optimizeConversationContext(turns);
      expect(optimized).toEqual(turns);
    });

    it('should always keep the active latest user prompt intact', () => {
      const turns = [
        { role: 'user' as const, content: 'Turn 1' },
        { role: 'model' as const, content: 'Response 1' },
        { role: 'user' as const, content: 'Latest prompt from user' },
      ];
      const optimized = optimizeConversationContext(turns, { maxTurns: 2 });
      expect(optimized[optimized.length - 1].content).toBe('Latest prompt from user');
    });

    it('should ensure the dialogue starts with a user turn', () => {
      const turns = [
        { role: 'model' as const, content: 'Unmatched model turn' },
        { role: 'user' as const, content: 'Actual start' },
        { role: 'model' as const, content: 'Model reply' },
        { role: 'user' as const, content: 'Next user turn' },
      ];

      const optimized = optimizeConversationContext(turns);
      expect(optimized[0].role).toBe('user');
      expect(optimized[0].content).toBe('Actual start');
    });

    it('should enforce maximum turn constraints', () => {
      const turns: Array<{ role: 'user' | 'model'; content: string }> = [];
      for (let i = 0; i < 20; i++) {
        turns.push({ role: 'user', content: `User query ${i}` });
        turns.push({ role: 'model', content: `Assistant reply ${i}` });
      }
      turns.push({ role: 'user', content: 'Final active user message' });

      const optimized = optimizeConversationContext(turns, { maxTurns: 6 });
      expect(optimized.length).toBeLessThanOrEqual(7);
      expect(optimized[optimized.length - 1].content).toBe('Final active user message');
      expect(optimized[0].role).toBe('user');
    });
  });
});
