import { describe, it, expect, vi } from 'vitest';
import { runAllDiagnostics } from '../src/core/diagnostics';
import { memoryService } from '../src/core/memoryStore';
import { settingsService } from '../src/core/settingsStore';
import { platformBridge } from '../src/core/bridge';

describe('Diagnostics & Verification Suite (Phase 1 Foundation)', () => {
  it('should initialize and execute all 11 diagnostic test definitions', async () => {
    // Mock global fetch for API endpoints during offline diagnostic runs
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/health')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'ok', assistant: 'Jenna', hasApiKey: true }),
        });
      }
      if (url.includes('/api/chat/stream')) {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('data: {"type":"token","token":"Jenna test"}\n\n')
            );
            controller.enqueue(new TextEncoder().encode('data: {"type":"done"}\n\n'));
            controller.close();
          },
        });
        return Promise.resolve({
          ok: true,
          body: stream,
        });
      }
      if (url.includes('/api/tts')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ audio: 'dGVzdA==', mimeType: 'audio/wav', voice: 'Kore' }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const updates: any[] = [];
    const results = await runAllDiagnostics((tests) => {
      updates.push(tests);
    });

    expect(results.length).toBe(11);
    const testIds = results.map((t) => t.id);
    expect(testIds).toContain('test_health');
    expect(testIds).toContain('test_ai_brain_registry');
    expect(testIds).toContain('test_stream');
    expect(testIds).toContain('test_context_window');
    expect(testIds).toContain('test_storage');
    expect(testIds).toContain('test_memory');
    expect(testIds).toContain('test_settings');
    expect(testIds).toContain('test_user_identity');
    expect(testIds).toContain('test_tts');
    expect(testIds).toContain('test_stt');
    expect(testIds).toContain('test_platform');

    // All test statuses should be success
    const failed = results.filter((r) => r.status === 'failed');
    expect(failed.length).toBe(0);

    // Global fetch restored
    global.fetch = originalFetch;
  });
});
