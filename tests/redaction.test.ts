import { describe, it, expect } from 'vitest';
import {
  redactSecrets,
  redactDeep,
  registerSecret,
} from '../server/middleware/redact';

describe('Secret Redaction (Jarvis Phase 2 — WS0)', () => {
  it('redacts Google API keys', () => {
    const input = 'Request failed with key AIzaSyD-1234567890abcdefghijklmnopqrst embedded';
    expect(redactSecrets(input)).not.toContain('AIzaSyD-1234567890abcdefghijklmnopqrst');
    expect(redactSecrets(input)).toContain('[REDACTED]');
  });

  it('redacts OpenAI-style keys', () => {
    const input = 'auth: sk-proj4abcdefghijklmnopqrstuvwxyz1234567890';
    expect(redactSecrets(input)).not.toContain('sk-proj4abcdefghijklmnopqrstuvwxyz');
  });

  it('redacts GitHub tokens (classic and fine-grained)', () => {
    expect(redactSecrets('token ghp_abcdefghijklmnopqrstuvwxyz123456')).not.toContain('ghp_abcdef');
    expect(
      redactSecrets('github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz12345')
    ).not.toContain('github_pat_11ABCDEFG');
  });

  it('redacts Bearer tokens in error dumps', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload';
    expect(redactSecrets(input)).not.toContain('eyJhbGciOiJIUzI1NiI');
  });

  it('redacts PEM private key blocks', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----';
    expect(redactSecrets(`config: ${pem}`)).not.toContain('MIIEvQIBADANBg');
  });

  it('redacts exact registered secrets regardless of pattern', () => {
    registerSecret('my-custom-webhook-secret-value-42');
    const out = redactSecrets('posting to hook with my-custom-webhook-secret-value-42 now');
    expect(out).not.toContain('my-custom-webhook-secret-value-42');
    expect(out).toContain('[REDACTED]');
  });

  it('deep-redacts nested objects and arrays', () => {
    const obj = {
      note: 'key is AIzaSyD-1234567890abcdefghijklmnopqrst',
      nested: { list: ['ghp_abcdefghijklmnopqrstuvwxyz123456'] },
      num: 42,
    };
    const out = redactDeep(obj);
    expect(JSON.stringify(out)).not.toContain('AIzaSyD-1234567890');
    expect(JSON.stringify(out)).not.toContain('ghp_abcdef');
    expect(out.num).toBe(42);
  });

  it('leaves ordinary text untouched', () => {
    const text = 'The weather in Indore is sunny today, around 31 degrees.';
    expect(redactSecrets(text)).toBe(text);
  });
});
