export class UnsafeUrlError extends Error {
  constructor(message = 'The provider URL is not allowed.') {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const values = parts.map((part) => Number(part));
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  return values;
}

function isBlockedIpv4(values: number[]): boolean {
  const [a, b] = values;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b !== undefined && b >= 64 && b <= 127) ||
    (a === 192 && b === 0) ||
    (a === 198 && b !== undefined && (b === 18 || b === 19)) ||
    (a === 203 && b === 0) ||
    (a !== undefined && a >= 224)
  );
}

function isBlockedIpv6(hostname: string): boolean {
  const value = hostname.toLowerCase();
  return (
    value === '::1' ||
    value.startsWith('::ffff:') ||
    value.startsWith('fc') ||
    value.startsWith('fd') ||
    value.startsWith('fe80') ||
    value.startsWith('ff')
  );
}

/** Validates destination shape and blocks obvious non-public targets. */
export function assertSafePublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Enter a valid absolute URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeUrlError();
  if (url.username || url.password) throw new UnsafeUrlError();

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) throw new UnsafeUrlError();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.includes('.internal.')
  ) {
    throw new UnsafeUrlError();
  }

  const ipv4 = parseIpv4(hostname);
  if (ipv4 && isBlockedIpv4(ipv4)) throw new UnsafeUrlError();
  if (!ipv4 && hostname.includes(':') && isBlockedIpv6(hostname)) throw new UnsafeUrlError();

  return url;
}

const DNS_RESOLVER = 'https://cloudflare-dns.com/dns-query';

type DnsResponse = { Answer?: Array<{ type?: number; data?: string }> };

function isBlockedIpLiteral(value: string): boolean {
  const ipv4 = parseIpv4(value);
  if (ipv4) return isBlockedIpv4(ipv4);
  return isBlockedIpv6(value);
}

/**
 * Defence in depth against hostnames that resolve to private addresses. Workers
 * do not expose the socket's resolved IP, so this asks a fixed public resolver
 * before the request. This is not a guarantee against DNS rebinding.
 */
export async function assertSafeResolvedHost(
  hostname: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const clean = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (parseIpv4(clean) || clean.includes(':')) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const responses = await Promise.all(
      ['A', 'AAAA'].map((type) =>
        fetchImpl(`${DNS_RESOLVER}?name=${encodeURIComponent(clean)}&type=${type}`, {
          headers: { accept: 'application/dns-json' },
          signal: controller.signal,
        }),
      ),
    );
    const answers: Array<{ data?: string }> = [];
    for (const response of responses) {
      if (!response.ok) throw new UnsafeUrlError();
      const payload = (await response.json()) as DnsResponse;
      answers.push(...(payload.Answer ?? []).filter((answer) => answer.type === 1 || answer.type === 28));
    }
    if (answers.length === 0) throw new UnsafeUrlError();
    for (const answer of answers) {
      if (!answer.data || isBlockedIpLiteral(answer.data)) throw new UnsafeUrlError();
    }
  } catch (error) {
    if (error instanceof UnsafeUrlError) throw error;
    throw new UnsafeUrlError('The provider host could not be verified.');
  } finally {
    clearTimeout(timer);
  }
}
