/**
 * Encrypted credential store for account connections (e.g. GitHub OAuth tokens).
 * AES-256-GCM; key derived from JARVIS_SECRET_KEY env or an auto-generated
 * key file stored outside git (data/.jarvis_secret, chmod 600).
 * Tokens are NEVER written to logs, events, prompts, or client storage.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  upsertConnection,
  getConnection,
  deleteConnection,
  listConnections,
} from '../db/index';
import { registerSecret } from '../middleware/redact';

export interface ConnectionSecret {
  accessToken: string;
  tokenType?: string;
  scopes?: string[];
  meta?: Record<string, string>;
}

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const envKey = process.env.JARVIS_SECRET_KEY;
  if (envKey && envKey.length >= 32) {
    cachedKey = crypto.createHash('sha256').update(envKey).digest();
    return cachedKey;
  }
  const dataDir = process.env.JARVIS_DATA_DIR || path.join(process.cwd(), 'data');
  const keyFile = path.join(dataDir, '.jarvis_secret');
  try {
    if (fs.existsSync(keyFile)) {
      const raw = fs.readFileSync(keyFile, 'utf8').trim();
      if (raw.length >= 32) {
        cachedKey = crypto.createHash('sha256').update(raw).digest();
        return cachedKey;
      }
    }
    fs.mkdirSync(dataDir, { recursive: true });
    const fresh = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(keyFile, fresh, { mode: 0o600 });
    cachedKey = crypto.createHash('sha256').update(fresh).digest();
    return cachedKey;
  } catch {
    // Last resort: process-lifetime ephemeral key (connections won't survive restart)
    cachedKey = crypto.randomBytes(32);
    return cachedKey;
  }
}

export function encryptSecret(secret: ConnectionSecret): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(secret), 'utf8');
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(blob: string): ConnectionSecret | null {
  try {
    const buf = Buffer.from(blob, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return JSON.parse(dec.toString('utf8')) as ConnectionSecret;
  } catch {
    return null;
  }
}

export function saveConnection(provider: string, secret: ConnectionSecret): void {
  registerSecret(secret.accessToken);
  upsertConnection(provider, encryptSecret(secret), (secret.scopes || []).join(','));
}

export function loadConnection(provider: string): ConnectionSecret | null {
  const row = getConnection(provider);
  if (!row) return null;
  const secret = decryptSecret(row.enc_blob);
  if (secret) registerSecret(secret.accessToken);
  return secret;
}

export function removeConnection(provider: string): void {
  deleteConnection(provider);
}

/** Public (non-secret) view for the Connections UI. */
export function connectionStatuses(): Array<{
  provider: string;
  connected: boolean;
  scopes: string[];
  createdAt: number;
}> {
  return listConnections().map((c) => ({
    provider: c.provider,
    connected: true,
    scopes: c.scopes ? c.scopes.split(',').filter(Boolean) : [],
    createdAt: c.createdAt,
  }));
}

/** Test hook. */
export function _resetKeyCache(): void {
  cachedKey = null;
}
