import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JennaConversationService } from '../src/core/conversationStore';
import { platformBridge } from '../src/core/bridge';

describe('Conversation Management Service (Phase 1 Foundation)', () => {
  let service: JennaConversationService;

  beforeEach(() => {
    service = new JennaConversationService();
    // Reset platform bridge mock storage
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  it('should initialize and create a default conversation if none exist', async () => {
    const activeId = await service.init();
    expect(activeId).toBeDefined();
    expect(service.getConversations().length).toBeGreaterThanOrEqual(1);
    expect(service.getActiveConversationId()).toBe(activeId);
  });

  it('should create new conversations with custom titles and unique IDs', async () => {
    const conv = await service.createNewConversation('Coding Assistant Session');
    expect(conv.id).toMatch(/^conv_/);
    expect(conv.title).toBe('Coding Assistant Session');
    expect(conv.messageCount).toBe(0);
    expect(service.getActiveConversationId()).toBe(conv.id);
  });

  it('should switch active conversation and retrieve its specific messages', async () => {
    const conv1 = await service.createNewConversation('First Chat');
    await service.addMessage({
      conversationId: conv1.id,
      role: 'user',
      content: 'Message in conv 1',
      status: 'complete',
    });

    const conv2 = await service.createNewConversation('Second Chat');
    await service.addMessage({
      conversationId: conv2.id,
      role: 'user',
      content: 'Message in conv 2',
      status: 'complete',
    });

    expect(service.getActiveConversationId()).toBe(conv2.id);
    expect(service.getCurrentMessages()[0]?.content).toBe('Message in conv 2');

    await service.selectConversation(conv1.id);
    expect(service.getActiveConversationId()).toBe(conv1.id);
    expect(service.getCurrentMessages()[0]?.content).toBe('Message in conv 1');
  });

  it('should append streaming tokens to an active message in real-time', async () => {
    const conv = await service.createNewConversation('Streaming Test');
    const msg = await service.addMessage({
      conversationId: conv.id,
      role: 'assistant',
      content: '',
      status: 'streaming',
    });

    await service.appendTokenToMessage(msg.id, 'Hello ');
    await service.appendTokenToMessage(msg.id, 'world!');

    const current = service.getCurrentMessages().find((m) => m.id === msg.id);
    expect(current?.content).toBe('Hello world!');
    expect(current?.status).toBe('streaming');

    await service.finalizeStreamingMessage(msg.id, 'complete');
    const finalized = service.getCurrentMessages().find((m) => m.id === msg.id);
    expect(finalized?.status).toBe('complete');
  });

  it('should handle streaming message errors gracefully', async () => {
    const conv = await service.createNewConversation('Streaming Error Test');
    const msg = await service.addMessage({
      conversationId: conv.id,
      role: 'assistant',
      content: 'Partial content',
      status: 'streaming',
    });

    await service.finalizeStreamingMessage(msg.id, 'error', 'Network timeout');
    const failed = service.getCurrentMessages().find((m) => m.id === msg.id);
    expect(failed?.status).toBe('error');
    expect(failed?.error).toBe('Network timeout');
  });

  it('should support updating and deleting individual messages', async () => {
    const conv = await service.createNewConversation('Edit Message Test');
    const msg = await service.addMessage({
      conversationId: conv.id,
      role: 'user',
      content: 'Original prompt',
      status: 'complete',
    });

    await service.updateMessage(msg.id, { content: 'Updated prompt' });
    expect(service.getCurrentMessages()[0].content).toBe('Updated prompt');

    await service.deleteMessage(msg.id);
    expect(service.getCurrentMessages().length).toBe(0);
  });

  it('should toggle pin state and re-order pinned conversations to the top', async () => {
    const c1 = await service.createNewConversation('Chat 1');
    const c2 = await service.createNewConversation('Chat 2');

    // Pin chat 1
    await service.togglePinConversation(c1.id);
    const sorted = service.getConversations();
    expect(sorted[0].id).toBe(c1.id);
    expect(sorted[0].isPinned).toBe(true);
  });

  it('should export all conversation data in standard JSON format', async () => {
    await service.createNewConversation('Exportable Chat');
    const exported = service.exportAllDataJSON();
    const parsed = JSON.parse(exported);

    expect(parsed.version).toBe('1.0');
    expect(Array.isArray(parsed.conversations)).toBe(true);
    expect(parsed.conversations.length).toBeGreaterThanOrEqual(1);
  });

  it('should notify subscribers when conversation state changes', async () => {
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);

    await service.createNewConversation('Observed Chat');
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    listener.mockClear();
    await service.createNewConversation('Unobserved Chat');
    expect(listener).not.toHaveBeenCalled();
  });
});
