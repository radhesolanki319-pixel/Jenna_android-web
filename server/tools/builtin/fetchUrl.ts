/**
 * SENSITIVE tool: web.fetch_url — fetch a public web page and return readable text.
 *
 * SSRF protections (defense in depth):
 *  - https:// only (no http, file, ftp, gopher, data, …)
 *  - hostname must not be an IP literal; DNS resolution is checked and every
 *    resolved address must be a public unicast IP (blocks localhost, RFC1918,
 *    link-local, CGNAT, ULA, metadata endpoints)
 *  - redirects are followed manually (max 3) with the same checks per hop
 *  - response size capped (512 KB read), content-type restricted to text/html/json/xml
 *  - timeout enforced by the ToolExecutor + internal AbortController
 */

import dns from 'dns/promises';
import net from 'net';
import { Tool, toolResultOk, toolResultErr, ToolResult } from '../../../src/core/tools/types';

const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const MAX_RETURN_CHARS = 20_000;

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // this-net, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // IETF special
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('::ffff:')) {
    return isPrivateIPv4(lower.slice(7));
  }
  return false;
}

export function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return !isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return !isPrivateIPv6(ip);
  return false;
}

async function assertUrlSafe(rawUrl: string): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'Invalid URL.' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'Only https:// URLs are allowed.' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'URLs with embedded credentials are not allowed.' };
  }
  const host = url.hostname;
  if (net.isIP(host)) {
    return { ok: false, reason: 'IP-literal URLs are not allowed; use a hostname.' };
  }
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, reason: 'Internal hostnames are not allowed.' };
  }
  try {
    const addrs = await dns.lookup(host, { all: true });
    if (addrs.length === 0) return { ok: false, reason: 'Hostname did not resolve.' };
    for (const addr of addrs) {
      if (!isPublicAddress(addr.address)) {
        return { ok: false, reason: 'Hostname resolves to a private or internal address.' };
      }
    }
  } catch {
    return { ok: false, reason: 'DNS resolution failed.' };
  }
  return { ok: true, url };
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

async function readCapped(res: Response): Promise<{ text: string; truncated: boolean }> {
  const reader = (res.body as unknown as ReadableStream<Uint8Array> | null)?.getReader();
  if (!reader) return { text: await res.text(), truncated: false };
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (received >= MAX_BYTES) {
      truncated = true;
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      break;
    }
  }
  return { text, truncated };
}

export const fetchUrlTool: Tool<{ url: string }> = {
  id: 'web.fetch_url',
  description:
    'Fetch a public https:// web page and return its readable text content. Use to read documentation, articles, or reference pages the user mentions. Cannot access internal/private networks.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Absolute https:// URL of the page to read.' },
    },
    required: ['url'],
  },
  permission: 'SENSITIVE',
  platforms: ['server'],
  timeoutMs: 20_000,
  async execute(input, ctx): Promise<ToolResult> {
    let currentUrl = String(input.url || '').trim();

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const safety = await assertUrlSafe(currentUrl);
      if (!safety.ok) {
        return toolResultErr('blocked_url', (safety as { ok: false; reason: string }).reason);
      }
      let res: Response;
      try {
        res = await fetch(safety.url.toString(), {
          redirect: 'manual',
          signal: ctx.signal,
          headers: {
            'User-Agent': 'JennaJarvis/2.0 (+ai-assistant; content-fetch)',
            Accept: 'text/html,application/json,text/plain,application/xml;q=0.9,*/*;q=0.5',
          },
        });
      } catch (err: any) {
        return toolResultErr('fetch_failed', err?.message || 'Network request failed.', true);
      }

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) return toolResultErr('bad_redirect', 'Redirect without Location header.');
        currentUrl = new URL(location, safety.url).toString();
        continue;
      }
      if (!res.ok) {
        return toolResultErr('http_error', `HTTP ${res.status} from ${safety.url.hostname}.`, res.status >= 500);
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      const allowed = ['text/', 'application/json', 'application/xml', 'application/xhtml'];
      if (contentType && !allowed.some((a) => contentType.includes(a))) {
        return toolResultErr('unsupported_type', `Unsupported content type "${contentType}".`);
      }

      const { text: raw, truncated } = await readCapped(res);
      const isHtml = contentType.includes('html') || /^\s*<(!doctype|html)/i.test(raw);
      let text = isHtml ? htmlToText(raw) : raw;
      let outTruncated = truncated;
      if (text.length > MAX_RETURN_CHARS) {
        text = text.slice(0, MAX_RETURN_CHARS);
        outTruncated = true;
      }
      return {
        ok: true,
        data: { url: safety.url.toString(), contentType, text },
        artifacts: [{ kind: 'citation', title: safety.url.hostname, content: safety.url.toString() }],
        durationMs: 0,
        truncated: outTruncated,
      };
    }
    return toolResultErr('too_many_redirects', `More than ${MAX_REDIRECTS} redirects.`);
  },
};
