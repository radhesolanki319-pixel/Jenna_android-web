/**
 * Generic OAuth 2.0 Device Authorization Grant engine (RFC 8628).
 * Used for GitHub (and future providers) — never embeds PATs or client secrets
 * in the app; only a public client_id plus user-visible device codes.
 *
 * Flow:
 *   1. POST /api/connections/:provider/start  → { userCode, verificationUri, interval }
 *   2. User enters code at the provider's verification page.
 *   3. Client polls POST /api/connections/:provider/poll until 'connected'.
 */

import { saveConnection } from './store';

export interface DeviceFlowProviderConfig {
  provider: string;
  clientIdEnv: string; // env var holding the OAuth App client_id
  deviceCodeUrl: string;
  tokenUrl: string;
  scopes: string[];
  enabled: boolean; // feature flag
}

export interface DeviceFlowSession {
  provider: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  intervalSec: number;
  expiresAt: number;
  status: 'pending' | 'connected' | 'expired' | 'error';
  error?: string;
}

const sessions = new Map<string, DeviceFlowSession>();

export const PROVIDERS: Record<string, DeviceFlowProviderConfig> = {
  github: {
    provider: 'github',
    clientIdEnv: 'GITHUB_OAUTH_CLIENT_ID',
    deviceCodeUrl: 'https://github.com/login/device/code',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['repo', 'read:user'],
    // GitHub tooling ships in Phase 3; the flow is functional once a client_id
    // is configured, but the feature is flagged off by default.
    enabled: process.env.JARVIS_GITHUB_ENABLED === 'true',
  },
};

export function providerConfig(provider: string): DeviceFlowProviderConfig | undefined {
  return PROVIDERS[provider];
}

export function isProviderAvailable(provider: string): { available: boolean; reason?: string } {
  const cfg = PROVIDERS[provider];
  if (!cfg) return { available: false, reason: 'Unknown provider.' };
  if (!cfg.enabled) return { available: false, reason: 'Provider not enabled yet (coming in Phase 3).' };
  if (!process.env[cfg.clientIdEnv]) {
    return { available: false, reason: `Missing ${cfg.clientIdEnv} configuration.` };
  }
  return { available: true };
}

export async function startDeviceFlow(provider: string): Promise<DeviceFlowSession> {
  const cfg = PROVIDERS[provider];
  const avail = isProviderAvailable(provider);
  if (!cfg || !avail.available) {
    throw new Error(avail.reason || 'Provider unavailable.');
  }
  const clientId = process.env[cfg.clientIdEnv] as string;

  const res = await fetch(cfg.deviceCodeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: cfg.scopes.join(' ') }),
  });
  if (!res.ok) {
    throw new Error(`Device flow start failed (HTTP ${res.status}).`);
  }
  const data = (await res.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval?: number;
  };

  const session: DeviceFlowSession = {
    provider,
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    intervalSec: data.interval || 5,
    expiresAt: Date.now() + data.expires_in * 1000,
    status: 'pending',
  };
  sessions.set(provider, session);
  return session;
}

export async function pollDeviceFlow(provider: string): Promise<DeviceFlowSession> {
  const cfg = PROVIDERS[provider];
  const session = sessions.get(provider);
  if (!cfg || !session) {
    throw new Error('No active device-flow session. Start pairing first.');
  }
  if (session.status !== 'pending') return session;
  if (Date.now() > session.expiresAt) {
    session.status = 'expired';
    return session;
  }

  const clientId = process.env[cfg.clientIdEnv] as string;
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      device_code: session.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    token_type?: string;
    scope?: string;
    error?: string;
  };

  if (data.access_token) {
    saveConnection(provider, {
      accessToken: data.access_token,
      tokenType: data.token_type || 'bearer',
      scopes: (data.scope || '').split(/[ ,]+/).filter(Boolean),
    });
    session.status = 'connected';
    session.deviceCode = ''; // no longer needed; drop it
  } else if (data.error && data.error !== 'authorization_pending' && data.error !== 'slow_down') {
    session.status = 'error';
    session.error = data.error;
  }
  return session;
}

/** Public session view — never exposes the device_code. */
export function sessionPublicView(s: DeviceFlowSession) {
  return {
    provider: s.provider,
    userCode: s.userCode,
    verificationUri: s.verificationUri,
    intervalSec: s.intervalSec,
    expiresAt: s.expiresAt,
    status: s.status,
    error: s.error,
  };
}

/** Test hook. */
export function _resetSessions(): void {
  sessions.clear();
}
