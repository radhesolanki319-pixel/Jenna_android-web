import { describe, it, expect, beforeEach } from 'vitest';
import { ApiKeyService } from '../src/core/apiKeyStore';

const VALID_KEY = 'AIzaSyA1234567890abcdefghijklmnopqrstuv';
const VALID_KEY_2 = 'AIzaSyB0987654321qrstuvwxyzabcdefghijklmnop';

describe('API Key Store (Bring Your Own Key)', () => {
  let apiKeyService: ApiKeyService;

  beforeEach(() => {
    apiKeyService = new ApiKeyService();
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  it('starts empty with no key connected', () => {
    expect(apiKeyService.has()).toBe(false);
    expect(apiKeyService.get()).toBe('');
    expect(apiKeyService.authHeaders()).toEqual({});
  });

  it('saves a valid Gemini API key and exposes auth headers', () => {
    const error = apiKeyService.save(VALID_KEY);
    expect(error).toBeNull();

    expect(apiKeyService.has()).toBe(true);
    expect(apiKeyService.get()).toBe(VALID_KEY);
    expect(apiKeyService.authHeaders()).toEqual({ 'x-gemini-key': VALID_KEY });
  });

  it('trims whitespace when saving', () => {
    const error = apiKeyService.save(`  ${VALID_KEY}  `);
    expect(error).toBeNull();
    expect(apiKeyService.get()).toBe(VALID_KEY);
  });

  it('rejects malformed keys with a helpful error', () => {
    expect(apiKeyService.save('')).toBeTruthy();
    expect(apiKeyService.save('not-a-key')).toBeTruthy();
    expect(apiKeyService.save('AIzaTooShort')).toBeTruthy();
    expect(apiKeyService.has()).toBe(false);
  });

  it('never persists state after a failed save', () => {
    apiKeyService.save('garbage');
    expect(apiKeyService.get()).toBe('');
    expect(apiKeyService.authHeaders()).toEqual({});
  });

  it('clears a connected key', () => {
    apiKeyService.save(VALID_KEY);
    expect(apiKeyService.has()).toBe(true);

    apiKeyService.clear();
    expect(apiKeyService.has()).toBe(false);
    expect(apiKeyService.get()).toBe('');
    expect(apiKeyService.authHeaders()).toEqual({});
  });

  it('notifies subscribers on save and clear', () => {
    let notifications = 0;
    const unsubscribe = apiKeyService.subscribe(() => {
      notifications += 1;
    });

    apiKeyService.save(VALID_KEY);
    apiKeyService.clear();

    expect(notifications).toBe(2);
    unsubscribe();
  });

  it('stops notifying after unsubscribe', () => {
    let notifications = 0;
    const unsubscribe = apiKeyService.subscribe(() => {
      notifications += 1;
    });
    unsubscribe();

    apiKeyService.save(VALID_KEY);
    expect(notifications).toBe(0);
  });

  it('persists the key across service instances (browser reload)', () => {
    apiKeyService.save(VALID_KEY);

    const reloadedService = new ApiKeyService();
    expect(reloadedService.has()).toBe(true);
    expect(reloadedService.get()).toBe(VALID_KEY);
  });

  it('replaces an existing key with a new one', () => {
    apiKeyService.save(VALID_KEY);
    apiKeyService.save(VALID_KEY_2);

    expect(apiKeyService.get()).toBe(VALID_KEY_2);
    expect(apiKeyService.authHeaders()).toEqual({ 'x-gemini-key': VALID_KEY_2 });
  });

  it('validates key format independently of storage', () => {
    expect(apiKeyService.isValidFormat(VALID_KEY)).toBe(true);
    expect(apiKeyService.isValidFormat('sk-openai-style-key')).toBe(false);
    expect(apiKeyService.isValidFormat('')).toBe(false);
  });
});
