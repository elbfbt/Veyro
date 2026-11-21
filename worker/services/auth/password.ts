import type { PasswordHasher } from './types';
import { fromBase64Url, randomToken, toBase64Url } from './tokens';

const ITERATIONS = 210_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const ALGORITHM = 'pbkdf2-sha256';
const encoder = new TextEncoder();

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/**
 * PBKDF2-SHA-256 via Web Crypto — a standard primitive supported by both
 * Cloudflare Workers and Node, with no custom cryptography.
 */
export class WebCryptoPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomToken(SALT_BYTES);
    const saltBytes = fromBase64Url(salt);
    const derived = await derive(password, saltBytes, ITERATIONS);
    return `${ALGORITHM}$${ITERATIONS}$${salt}$${toBase64Url(derived)}`;
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    const parts = encoded.split('$');
    if (parts.length !== 4) return false;
    const [algorithm, iterationText, salt, expected] = parts;
    if (algorithm !== ALGORITHM || !iterationText || !salt || !expected) return false;
    const iterations = Number(iterationText);
    if (!Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) return false;

    try {
      const derived = await derive(password, fromBase64Url(salt), iterations);
      const expectedBytes = fromBase64Url(expected);
      if (derived.length !== expectedBytes.length) return false;
      let difference = 0;
      for (let index = 0; index < derived.length; index += 1) {
        difference |= derived[index]! ^ expectedBytes[index]!;
      }
      return difference === 0;
    } catch {
      return false;
    }
  }
}

export const passwordHashFormat = { algorithm: ALGORITHM, iterations: ITERATIONS };
