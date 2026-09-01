/**
 * Shared secret redaction — applied at every log/stream/tool-output boundary.
 * Generalizes the previous inline AIza… scrubbing into a single tested module.
 */

const PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z\-_]{20,50}/g, // Google API keys
  /sk-[A-Za-z0-9\-_]{20,120}/g, // OpenAI-style secret keys
  /sk-ant-[A-Za-z0-9\-_]{20,120}/g, // Anthropic keys
  /gh[pousr]_[A-Za-z0-9]{20,120}/g, // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_)
  /github_pat_[A-Za-z0-9_]{20,255}/g, // GitHub fine-grained PATs
  /Bearer\s+[A-Za-z0-9\-._~+/]{16,}=*/g, // Bearer tokens in error dumps
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, // PEM blocks
];

/** Exact-match secrets registered at boot (env values, connection tokens). */
const knownSecrets = new Set<string>();

export function registerSecret(value: string | undefined | null): void {
  if (value && value.length >= 8) {
    knownSecrets.add(value);
  }
}

/** Register all secret-looking env values on boot. */
export function registerEnvSecrets(env: NodeJS.ProcessEnv = process.env): void {
  const SECRET_KEYS =
    /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i;
  for (const [k, v] of Object.entries(env)) {
    if (SECRET_KEYS.test(k) && v) {
      registerSecret(v);
    }
  }
}

export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  for (const secret of knownSecrets) {
    if (out.includes(secret)) {
      out = out.split(secret).join('[REDACTED]');
    }
  }
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, '[REDACTED]');
  }
  return out;
}

/** Deep-redacts a JSON-serializable value (returns a new value). */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return redactSecrets(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}
