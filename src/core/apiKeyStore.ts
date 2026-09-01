/**
 * Jenna API Key Store (Bring Your Own Key)
 * Holds the user's Gemini API key locally in the browser and attaches it
 * to every AI request via the `x-gemini-key` header. The key never leaves
 * the user's browser except in transit to this app's own server, and it is
 * never written to disk on the server.
 */

const STORAGE_KEY = 'jenna.geminiApiKey';

type ApiKeyListener = () => void;

export class ApiKeyService {
  private listeners: ApiKeyListener[] = [];

  private notify() {
    this.listeners.forEach((l) => l());
  }

  subscribe(listener: ApiKeyListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /** Get the stored API key (empty string when none is saved). */
  get(): string {
    if (typeof localStorage === 'undefined') return '';
    try {
      return (localStorage.getItem(STORAGE_KEY) || '').trim();
    } catch {
      return '';
    }
  }

  has(): boolean {
    return this.get().length > 0;
  }

  /**
   * Gemini API keys have the form `AIza...` (typically 39 chars).
   * This is a soft format check, not an authenticity check.
   */
  isValidFormat(key: string): boolean {
    const trimmed = key.trim();
    return /^AIza[0-9A-Za-z_-]{30,45}$/.test(trimmed);
  }

  /** Persist the key locally. Returns an error message on invalid input. */
  save(key: string): string | null {
    const trimmed = key.trim();
    if (!trimmed) return 'Please paste your Gemini API key first.';
    if (!this.isValidFormat(trimmed)) {
      return 'That does not look like a Gemini API key. Keys start with "AIza" — copy it from Google AI Studio.';
    }
    try {
      localStorage.setItem(STORAGE_KEY, trimmed);
    } catch {
      return 'Could not save the key in this browser (storage unavailable).';
    }
    this.notify();
    return null;
  }

  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage failures on clear
    }
    this.notify();
  }

  /**
   * Fetch headers that authenticate AI requests with the stored key.
   * Spread into the request headers: `...aiAuthHeaders()`
   */
  authHeaders(): Record<string, string> {
    const key = this.get();
    return key ? { 'x-gemini-key': key } : {};
  }
}

export const apiKeyService = new ApiKeyService();
