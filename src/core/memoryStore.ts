/**
 * Jenna Long-Term Memory Foundation
 * Manages persistent user facts, preferences, directives, and work context separately from ephemeral chat transcripts.
 */

import { MemoryItem, MemoryCategory, MemoryPriority } from '../types';
import { platformBridge } from './bridge';

export const MEMORY_CATEGORIES: { id: MemoryCategory; label: string; icon: string; description: string }[] = [
  {
    id: 'personal_facts',
    label: 'Personal Facts',
    icon: 'User',
    description: 'Name, location, background, family, pets, bio details',
  },
  {
    id: 'preferences',
    label: 'Preferences',
    icon: 'Heart',
    description: 'Tone, response structure, coding style, communication habits',
  },
  {
    id: 'directives',
    label: 'Directives',
    icon: 'Sparkles',
    description: 'Standing instructions and persistent rules Jenna must follow',
  },
  {
    id: 'projects_and_goals',
    label: 'Projects & Goals',
    icon: 'Target',
    description: 'Active endeavors, objectives, milestones, learning paths',
  },
  {
    id: 'work_context',
    label: 'Work Context',
    icon: 'Briefcase',
    description: 'Tech stack, company, role, study area, tools used',
  },
];

export class JennaMemoryService {
  private memoriesCache: MemoryItem[] = [];
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

  async load(): Promise<MemoryItem[]> {
    if (this.isLoaded && this.memoriesCache.length > 0) {
      return this.memoriesCache;
    }
    this.memoriesCache = await platformBridge.getMemories();
    this.isLoaded = true;
    this.notify();
    return this.memoriesCache;
  }

  getAll(): MemoryItem[] {
    return this.memoriesCache;
  }

  getByCategory(category: MemoryCategory): MemoryItem[] {
    return this.memoriesCache.filter((m) => m.category === category);
  }

  async addMemory(
    category: MemoryCategory,
    content: string,
    priority: MemoryPriority = 'medium',
    confidence = 1.0,
    sourceConversationId?: string
  ): Promise<MemoryItem> {
    const text = content.trim();
    const newMemory: MemoryItem = {
      id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      category,
      content: text,
      fact: text,
      priority,
      isPinned: priority === 'high',
      confidence,
      sourceConversationId,
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await platformBridge.saveMemory(newMemory);
    this.memoriesCache = [newMemory, ...this.memoriesCache];
    this.notify();
    return newMemory;
  }

  async updateMemory(id: string, updates: Partial<Omit<MemoryItem, 'id' | 'createdAt'>>): Promise<void> {
    const memory = this.memoriesCache.find((m) => m.id === id);
    if (!memory) return;

    const textContent = updates.content !== undefined ? updates.content.trim() : (updates.fact !== undefined ? updates.fact.trim() : memory.content);
    const priority: MemoryPriority = updates.priority || (updates.isPinned !== undefined ? (updates.isPinned ? 'high' : 'medium') : memory.priority);

    const updated: MemoryItem = {
      ...memory,
      ...updates,
      content: textContent,
      fact: textContent,
      priority,
      isPinned: priority === 'high',
      updatedAt: Date.now(),
    };

    await platformBridge.saveMemory(updated);
    this.memoriesCache = this.memoriesCache.map((m) => (m.id === id ? updated : m));
    this.notify();
  }

  async setPriority(id: string, priority: MemoryPriority): Promise<void> {
    await this.updateMemory(id, { priority, isPinned: priority === 'high' });
  }

  async toggleMemory(id: string): Promise<void> {
    const mem = this.memoriesCache.find((m) => m.id === id);
    if (mem) {
      await this.updateMemory(id, { enabled: !mem.enabled });
    }
  }

  async deleteMemory(id: string): Promise<void> {
    await platformBridge.deleteMemory(id);
    this.memoriesCache = this.memoriesCache.filter((m) => m.id !== id);
    this.notify();
  }

  async clearAll(): Promise<void> {
    await platformBridge.clearAllMemories();
    this.memoriesCache = [];
    this.notify();
  }

  /**
   * Get contextual relevant memories for the active conversation turn
   */
  getRelevantMemories(
    queryText = '',
    recentHistory: Array<{ role: string; content: string }> = [],
    maxCount = 6
  ): { id: string; category: string; fact: string; priority: MemoryPriority }[] {
    const enabled = this.memoriesCache.filter((m) => m.enabled && (m.content || m.fact));
    if (enabled.length === 0) return [];

    // Extract search tokens from prompt and latest messages
    const contextWords = [
      queryText,
      ...recentHistory.slice(-3).map((m) => m.content),
    ]
      .join(' ')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3);

    const scored = enabled.map((mem) => {
      const memText = (mem.content || mem.fact || '').toLowerCase();
      let score = 0;

      // Base weight by category and priority
      if (mem.category === 'directives') score += 4.0;
      if (mem.priority === 'high' || mem.isPinned) score += 3.0;
      else if (mem.priority === 'medium') score += 1.5;
      else score += 0.8;

      // Keyword match scoring
      for (const word of contextWords) {
        if (memText.includes(word)) {
          score += 2.0;
        }
      }

      // Recency weighting
      const hoursOld = (Date.now() - mem.updatedAt) / (1000 * 60 * 60);
      if (hoursOld < 24) score += 0.5;

      return { mem, score };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, maxCount).map(({ mem }) => ({
      id: mem.id,
      category: mem.category.replace(/_/g, ' '),
      fact: mem.content || mem.fact || '',
      priority: mem.priority,
    }));
  }

  /**
   * Get formatted memories to inject into the Gemini system context (backward compatibility)
   */
  getInjectedMemories(maxCount = 6, queryText = ''): { category: string; fact: string }[] {
    const relevant = this.getRelevantMemories(queryText, [], maxCount);
    return relevant.map((r) => ({
      category: r.category,
      fact: r.fact,
    }));
  }

  /**
   * Export all memories as JSON for backups / sync
   */
  exportJSON(): string {
    return JSON.stringify(
      {
        version: '1.0',
        platform: 'jenna_core',
        exportedAt: new Date().toISOString(),
        memories: this.memoriesCache,
      },
      null,
      2
    );
  }

  /**
   * Import memories from JSON
   */
  async importJSON(jsonStr: string): Promise<number> {
    try {
      const data = JSON.parse(jsonStr);
      const items: any[] = Array.isArray(data) ? data : data.memories || [];
      let importedCount = 0;

      for (const item of items) {
        const text = item.content || item.fact;
        if (text && (item.category || item.category === 'instructions')) {
          let cat: MemoryCategory = item.category;
          if ((item.category as any) === 'instructions') cat = 'directives';
          if ((item.category as any) === 'context_and_work') cat = 'work_context';
          if (!['personal_facts', 'preferences', 'directives', 'projects_and_goals', 'work_context'].includes(cat)) {
            cat = 'preferences';
          }

          const priority: MemoryPriority = item.priority || (item.isPinned ? 'high' : 'medium');
          const exists = this.memoriesCache.some(
            (existing) => (existing.content || existing.fact || '').toLowerCase() === text.toLowerCase()
          );

          if (!exists) {
            await this.addMemory(
              cat,
              text,
              priority,
              item.confidence || 1.0,
              item.sourceConversationId
            );
            importedCount++;
          }
        }
      }
      return importedCount;
    } catch {
      throw new Error('Invalid JSON format for memory import.');
    }
  }

  /**
   * Trigger AI memory extraction from a conversation
   */
  async extractMemoriesFromChat(messages: Array<{ role: string; content: string }>): Promise<MemoryItem[]> {
    if (messages.length === 0) return [];
    
    const res = await fetch('/api/memory/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });

    if (!res.ok) {
      throw new Error('Failed to extract memories.');
    }

    const data = await res.json();
    return (data.memories || []).map((m: any) => {
      let cat: MemoryCategory = m.category;
      if ((m.category as any) === 'instructions') cat = 'directives';
      if ((m.category as any) === 'context_and_work') cat = 'work_context';
      if (!['personal_facts', 'preferences', 'directives', 'projects_and_goals', 'work_context'].includes(cat)) {
        cat = 'preferences';
      }
      return {
        id: `extracted_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        category: cat,
        content: m.content || m.fact || '',
        fact: m.content || m.fact || '',
        priority: 'medium',
        confidence: m.confidence || 0.9,
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    });
  }
}

export const memoryService = new JennaMemoryService();
