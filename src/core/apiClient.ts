/**
 * Jarvis API client helper.
 * Centralizes fetch with optional bearer-token auth (pairing token).
 * When the server is started with JARVIS_API_TOKEN set, all /api/* requests
 * must carry `Authorization: Bearer <token>`; the token is stored locally
 * (never in memory items, never sent to the model).
 */

const TOKEN_STORAGE_KEY = 'jenna_api_token_v1';

export function getApiToken(): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
  return null;
}

export function setApiToken(token: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (token && token.trim()) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export function getAuthHeaders(): Record<string, string> {
  const token = getApiToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Drop-in replacement for fetch() on /api/* endpoints. */
export function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const token = getApiToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}
