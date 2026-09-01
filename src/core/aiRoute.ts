/**
 * AI Route Resolver
 * Decides whether Jenna's AI requests should travel through this app's server
 * (server has Gemini egress + key) or directly from the browser (user's own
 * connected key) — and detects when neither path is possible.
 */

import { apiKeyService } from './apiKeyStore';

export type AiRoute = 'server' | 'browser' | 'blocked';

let cache: { route: AiRoute; checkedAt: number } | null = null;

// Re-evaluate whenever the user connects or removes their key.
apiKeyService.subscribe(() => {
  cache = null;
});

function resolveCached(route: AiRoute): AiRoute {
  // A browser route is only viable while the local key exists.
  return route === 'browser' && !apiKeyService.has() ? 'blocked' : route;
}

export function getCachedAiRoute(): AiRoute | null {
  return cache ? resolveCached(cache.route) : null;
}

export function clearAiRouteCache(): void {
  cache = null;
}

/**
 * Probe the server's ability to reach the Gemini API and pick a route.
 * Results are cached for 60 seconds.
 */
export async function getAiRoute(): Promise<AiRoute> {
  if (cache && Date.now() - cache.checkedAt < 60_000) {
    return resolveCached(cache.route);
  }

  let egressReachable = false;
  try {
    const res = await fetch('/api/ai/probe', { headers: apiKeyService.authHeaders() });
    if (res.ok) {
      const data = await res.json();
      egressReachable = Boolean(data.egressReachable);
    }
  } catch {
    // Server unreachable entirely — browser-direct remains an option.
    egressReachable = false;
  }

  const route: AiRoute = egressReachable
    ? 'server'
    : apiKeyService.has()
    ? 'browser'
    : 'blocked';

  cache = { route, checkedAt: Date.now() };
  return route;
}
