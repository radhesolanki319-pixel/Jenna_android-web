import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JennaMemoryService, MEMORY_CATEGORIES } from '../src/core/memoryStore';
import { MemoryCategory } from '../src/types';

describe('Long-Term Memory Foundation Service (Phase 1 Foundation)', () => {
  let memoryService: JennaMemoryService;

  beforeEach(async () => {
    memoryService = new JennaMemoryService();
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  it('should define all 5 core memory categories with icons and descriptions', () => {
    expect(MEMORY_CATEGORIES.length).toBe(5);
    const categoryIds = MEMORY_CATEGORIES.map((c) => c.id);
    expect(categoryIds).toContain('personal_facts');
    expect(categoryIds).toContain('preferences');
    expect(categoryIds).toContain('directives');
    expect(categoryIds).toContain('projects_and_goals');
    expect(categoryIds).toContain('work_context');
  });

  it('should add new memories and prevent exact duplicates by updating existing ones', async () => {
    const mem1 = await memoryService.addMemory(
      'personal_facts',
      'User lives in Seattle and loves hiking.',
      'medium'
    );
    expect(mem1.id).toMatch(/^mem_/);
    expect(mem1.category).toBe('personal_facts');
    expect(mem1.content).toBe('User lives in Seattle and loves hiking.');
    expect(memoryService.getAll().length).toBe(1);

    // Add duplicate content with higher priority
    const mem2 = await memoryService.addMemory(
      'personal_facts',
      'User lives in Seattle and loves hiking.',
      'high',
      0.99
    );

    // Should update existing entry, not create a new one
    expect(mem2.id).toBe(mem1.id);
    expect(mem2.priority).toBe('high');
    expect(mem2.isPinned).toBe(true);
    expect(memoryService.getAll().length).toBe(1);
  });

  it('should filter memories by specific category', async () => {
    await memoryService.addMemory('personal_facts', 'Birthday is March 15th');
    await memoryService.addMemory('directives', 'Always use TypeScript in code snippets');
    await memoryService.addMemory('work_context', 'Senior Software Engineer');

    const directives = memoryService.getByCategory('directives');
    expect(directives.length).toBe(1);
    expect(directives[0].content).toBe('Always use TypeScript in code snippets');
  });

  it('should update memory content and priority levels', async () => {
    const mem = await memoryService.addMemory('preferences', 'Prefers dark mode UI', 'low');
    await memoryService.setPriority(mem.id, 'high');

    const updated = memoryService.getAll().find((m) => m.id === mem.id);
    expect(updated?.priority).toBe('high');
    expect(updated?.isPinned).toBe(true);

    await memoryService.updateMemory(mem.id, { content: 'Prefers AMOLED pitch black theme' });
    const textUpdated = memoryService.getAll().find((m) => m.id === mem.id);
    expect(textUpdated?.content).toBe('Prefers AMOLED pitch black theme');
  });

  it('should toggle memory enabled/disabled state and exclude disabled memories from injection', async () => {
    const mem = await memoryService.addMemory('directives', 'Never use semicolons');
    expect(mem.enabled).toBe(true);

    await memoryService.toggleMemory(mem.id);
    const disabled = memoryService.getAll().find((m) => m.id === mem.id);
    expect(disabled?.enabled).toBe(false);

    // Relevant memories query should not return disabled memory
    const relevant = memoryService.getRelevantMemories('semicolons');
    expect(relevant.some((r) => r.id === mem.id)).toBe(false);
  });

  it('should compute context-aware relevance scores correctly', async () => {
    await memoryService.addMemory('directives', 'Always write unit tests for every module', 'high');
    await memoryService.addMemory('work_context', 'Works on Kubernetes backend architecture', 'medium');
    await memoryService.addMemory('personal_facts', 'Has a pet golden retriever named Bruno', 'low');

    // Query relating to testing and code
    const results = memoryService.getRelevantMemories('How should I structure my unit tests?');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].fact).toContain('unit tests');
  });

  it('should export and import memories with JSON schema normalization', async () => {
    await memoryService.addMemory('personal_facts', 'Favorite coffee is Aeropress', 'medium');
    await memoryService.addMemory('projects_and_goals', 'Building Jenna AI Assistant', 'high');

    const exportedJSON = memoryService.exportJSON();
    const parsed = JSON.parse(exportedJSON);
    expect(parsed.platform).toBe('jenna_core');
    expect(parsed.memories.length).toBe(2);

    // Clear and re-import
    await memoryService.clearAll();
    expect(memoryService.getAll().length).toBe(0);

    const importedCount = await memoryService.importJSON(exportedJSON);
    expect(importedCount).toBe(2);
    expect(memoryService.getAll().length).toBe(2);
  });

  it('should delete memories and clear all storage', async () => {
    const mem = await memoryService.addMemory('preferences', 'Temporary preference');
    expect(memoryService.getAll().length).toBe(1);

    await memoryService.deleteMemory(mem.id);
    expect(memoryService.getAll().length).toBe(0);
  });
});
