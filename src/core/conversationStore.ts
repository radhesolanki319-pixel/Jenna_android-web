/**
 * Jenna Conversation Management & Persistence Service
 * Handles conversation state, message streaming updates, persistence, and synchronization readiness.
 */

import { Conversation, Message } from '../types';
import { platformBridge } from './bridge';

export class JennaConversationService {
  private conversations: Conversation[] = [];
  private activeConversationId: string | null = null;
  private currentMessages: Message[] = [];
  private isLoaded = false;
  private listeners: Array<() => void> = [];

  private notify() {
    this.listeners.forEach((l) => l());
  }

  subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  async init(): Promise<string> {
    if (!this.isLoaded) {
      this.conversations = await platformBridge.getConversations();
      this.isLoaded = true;
    }

    if (this.conversations.length === 0) {
      const initial = await this.createNewConversation('Welcome to Jenna');
      return initial.id;
    }

    // Try restoring the last active conversation if it exists
    const storedActiveId = (platformBridge as any).getActiveConversationId?.();
    const existingActive = storedActiveId
      ? this.conversations.find((c) => c.id === storedActiveId)
      : undefined;

    const active = existingActive || this.conversations[0];
    this.activeConversationId = active.id;
    (platformBridge as any).saveActiveConversationId?.(active.id);
    this.currentMessages = await platformBridge.getMessages(active.id);
    this.notify();
    return active.id;
  }

  getConversations(): Conversation[] {
    return this.conversations;
  }

  getActiveConversation(): Conversation | undefined {
    return this.conversations.find((c) => c.id === this.activeConversationId);
  }

  getActiveConversationId(): string | null {
    return this.activeConversationId;
  }

  getCurrentMessages(): Message[] {
    return this.currentMessages;
  }

  async selectConversation(id: string): Promise<void> {
    if (this.activeConversationId === id && this.currentMessages.length > 0) return;
    this.activeConversationId = id;
    (platformBridge as any).saveActiveConversationId?.(id);
    this.currentMessages = await platformBridge.getMessages(id);
    this.notify();
  }

  async createNewConversation(customTitle?: string): Promise<Conversation> {
    const newConv: Conversation = {
      id: `conv_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      title: customTitle || 'New Conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
      previewText: 'Start a conversation with Jenna...',
    };

    await platformBridge.saveConversation(newConv);
    this.conversations = [newConv, ...this.conversations];
    this.activeConversationId = newConv.id;
    (platformBridge as any).saveActiveConversationId?.(newConv.id);
    this.currentMessages = [];
    this.notify();
    return newConv;
  }

  async deleteConversation(id: string): Promise<void> {
    await platformBridge.deleteConversation(id);
    this.conversations = this.conversations.filter((c) => c.id !== id);

    if (this.activeConversationId === id) {
      if (this.conversations.length > 0) {
        await this.selectConversation(this.conversations[0].id);
      } else {
        await this.createNewConversation();
      }
    } else {
      this.notify();
    }
  }

  async updateConversationTitle(id: string, newTitle: string): Promise<void> {
    const conv = this.conversations.find((c) => c.id === id);
    if (!conv) return;

    conv.title = newTitle.trim() || 'Conversation';
    conv.updatedAt = Date.now();
    await platformBridge.saveConversation(conv);
    this.notify();
  }

  async togglePinConversation(id: string): Promise<void> {
    const conv = this.conversations.find((c) => c.id === id);
    if (!conv) return;

    conv.isPinned = !conv.isPinned;
    conv.updatedAt = Date.now();
    await platformBridge.saveConversation(conv);
    this.conversations.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return b.updatedAt - a.updatedAt;
    });
    this.notify();
  }

  async addMessage(msg: Omit<Message, 'id' | 'timestamp'>): Promise<Message> {
    const convId = msg.conversationId || this.activeConversationId;
    if (!convId) throw new Error('No active conversation');

    const newMessage: Message = {
      ...msg,
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      timestamp: Date.now(),
    };

    this.currentMessages = [...this.currentMessages, newMessage];
    await platformBridge.saveMessages(convId, this.currentMessages);

    // Update conversation metadata
    const conv = this.conversations.find((c) => c.id === convId);
    if (conv) {
      conv.updatedAt = Date.now();
      conv.messageCount = this.currentMessages.length;
      conv.previewText = newMessage.content.slice(0, 80) || 'New message';
      await platformBridge.saveConversation(conv);
    }

    this.notify();
    return newMessage;
  }

  async updateMessage(id: string, updates: Partial<Message>): Promise<void> {
    if (!this.activeConversationId) return;

    this.currentMessages = this.currentMessages.map((m) => {
      if (m.id === id) {
        return { ...m, ...updates };
      }
      return m;
    });

    await platformBridge.saveMessages(this.activeConversationId, this.currentMessages);
    this.notify();
  }

  async deleteMessage(id: string): Promise<void> {
    if (!this.activeConversationId) return;

    this.currentMessages = this.currentMessages.filter((m) => m.id !== id);
    await platformBridge.saveMessages(this.activeConversationId, this.currentMessages);

    const conv = this.conversations.find((c) => c.id === this.activeConversationId);
    if (conv) {
      conv.updatedAt = Date.now();
      conv.messageCount = this.currentMessages.length;
      const last = this.currentMessages[this.currentMessages.length - 1];
      conv.previewText = last ? last.content.slice(0, 80) : 'No messages';
      await platformBridge.saveConversation(conv);
    }
    this.notify();
  }

  async setMessagesForConversation(convId: string, messages: Message[]): Promise<void> {
    this.currentMessages = messages;
    await platformBridge.saveMessages(convId, messages);

    const conv = this.conversations.find((c) => c.id === convId);
    if (conv) {
      conv.updatedAt = Date.now();
      conv.messageCount = messages.length;
      const last = messages[messages.length - 1];
      conv.previewText = last ? last.content.slice(0, 80) : 'No messages';
      await platformBridge.saveConversation(conv);
    }
    this.notify();
  }

  async appendTokenToMessage(id: string, token: string): Promise<void> {
    const msg = this.currentMessages.find((m) => m.id === id);
    if (!msg) return;

    msg.content += token;
    msg.status = 'streaming';
    // Notify React components to render the new token
    this.notify();
  }

  async finalizeStreamingMessage(id: string, status: 'complete' | 'error', errorMsg?: string): Promise<void> {
    const msg = this.currentMessages.find((m) => m.id === id);
    if (!msg || !this.activeConversationId) return;

    msg.status = status;
    if (status === 'error') {
      msg.error = errorMsg || 'An error occurred during generation.';
    } else if (status === 'complete') {
      delete msg.error;
    }

    await platformBridge.saveMessages(this.activeConversationId, this.currentMessages);

    // Update conversation metadata
    const conv = this.conversations.find((c) => c.id === this.activeConversationId);
    if (conv) {
      conv.updatedAt = Date.now();
      conv.previewText = msg.content.slice(0, 80) || (status === 'error' ? 'Error occurred' : 'Response received');
      await platformBridge.saveConversation(conv);
    }

    this.notify();
  }

  /**
   * Request automated title generation if conversation is newly created
   */
  async autoGenerateTitleIfFirstMessage(firstMessageText: string): Promise<void> {
    const activeConv = this.getActiveConversation();
    if (!activeConv) return;

    // If already has custom title and multiple messages, skip
    if (activeConv.title !== 'New Conversation' && activeConv.title !== 'Welcome to Jenna') {
      return;
    }

    try {
      const res = await fetch('/api/chat/title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstMessage: firstMessageText }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.title) {
          await this.updateConversationTitle(activeConv.id, data.title);
        }
      }
    } catch {
      // Fallback: simple snippet
      const fallbackTitle = firstMessageText.slice(0, 30).trim();
      await this.updateConversationTitle(activeConv.id, fallbackTitle);
    }
  }

  exportAllDataJSON(): string {
    return JSON.stringify(
      {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        conversations: this.conversations,
      },
      null,
      2
    );
  }
}

export const conversationService = new JennaConversationService();
