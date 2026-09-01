import { describe, it, expect, beforeEach } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  saveConnection,
  loadConnection,
  removeConnection,
  connectionStatuses,
} from '../server/connections/store';
import { redactSecrets } from '../server/middleware/redact';
import { _closeDb } from '../server/db/index';

process.env.JARVIS_DB_MEMORY = 'true';
process.env.JARVIS_SECRET_KEY = 'test-master-key-for-unit-tests-only-0001';

describe('Encrypted Connection Store (Jarvis Phase 2 — WS7)', () => {
  beforeEach(() => {
    _closeDb();
  });

  it('round-trips a secret through AES-256-GCM', () => {
    const secret = { accessToken: 'gho_testtoken1234567890abcdefghij', scopes: ['repo'] };
    const blob = encryptSecret(secret);
    expect(blob).not.toContain('gho_testtoken');
    const decrypted = decryptSecret(blob);
    expect(decrypted?.accessToken).toBe(secret.accessToken);
    expect(decrypted?.scopes).toEqual(['repo']);
  });

  it('produces ciphertext that never contains the plaintext token', () => {
    const token = 'github_pat_11AAAAAAA0abcdefghijklmnopqrstuv';
    const blob = encryptSecret({ accessToken: token });
    expect(Buffer.from(blob, 'base64').toString('latin1')).not.toContain(token);
  });

  it('returns null for tampered ciphertext (GCM auth)', () => {
    const blob = encryptSecret({ accessToken: 'gho_testtoken1234567890abcdefghij' });
    const buf = Buffer.from(blob, 'base64');
    buf[buf.length - 1] ^= 0xff; // flip a ciphertext bit
    expect(decryptSecret(buf.toString('base64'))).toBeNull();
  });

  it('persists, loads, lists, and removes connections', () => {
    saveConnection('github', {
      accessToken: 'gho_testtoken1234567890abcdefghij',
      scopes: ['repo', 'read:user'],
    });
    const loaded = loadConnection('github');
    expect(loaded?.accessToken).toBe('gho_testtoken1234567890abcdefghij');

    const statuses = connectionStatuses();
    expect(statuses.find((s) => s.provider === 'github')?.scopes).toEqual(['repo', 'read:user']);

    removeConnection('github');
    expect(loadConnection('github')).toBeNull();
  });

  it('registers loaded tokens with the redactor (never leaks to logs)', () => {
    saveConnection('github', { accessToken: 'gho_secretleaktest1234567890abcd' });
    loadConnection('github');
    const logLine = 'accidentally logging gho_secretleaktest1234567890abcd here';
    expect(redactSecrets(logLine)).not.toContain('gho_secretleaktest');
  });
});
