import { toBase64Url } from '../auth/tokens';

export class ProviderCredentialError extends Error {
  constructor(message = 'Provider credentials could not be secured.') {
    super(message);
    this.name = 'ProviderCredentialError';
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const KEY_ID = 'aes-gcm-v1';

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * AES-GCM credential encryption using a Worker secret. Plaintext is only ever
 * returned to internal callers for the duration of an upstream request.
 */
export class ProviderCredentialCipher {
  private keyPromise: Promise<CryptoKey> | null = null;

  constructor(private readonly secret: string | undefined) {}

  get keyId(): string {
    return KEY_ID;
  }

  private key(): Promise<CryptoKey> {
    if (!this.keyPromise) {
      const secret = this.secret?.trim() ?? '';
      if (!/^[a-f0-9]{64}$/i.test(secret)) {
        throw new ProviderCredentialError('Provider credential encryption is not configured.');
      }
      const bytes = new Uint8Array(secret.length / 2);
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Number.parseInt(secret.slice(index * 2, index * 2 + 2), 16);
      }
      this.keyPromise = crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
    }
    return this.keyPromise;
  }

  async encrypt(plaintext: string): Promise<{ ciphertext: string; keyId: string }> {
    const key = await this.key();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext));
    return {
      ciphertext: `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`,
      keyId: this.keyId,
    };
  }

  async decrypt(ciphertext: string, keyId: string | null): Promise<string> {
    if (keyId !== KEY_ID) throw new ProviderCredentialError();
    const [ivPart, dataPart, ...extra] = ciphertext.split('.');
    if (!ivPart || !dataPart || extra.length > 0) throw new ProviderCredentialError();
    try {
      const key = await this.key();
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64Url(ivPart) },
        key,
        fromBase64Url(dataPart),
      );
      return decoder.decode(decrypted);
    } catch {
      // Never include ciphertext, plaintext or WebCrypto details in the error.
      throw new ProviderCredentialError();
    }
  }
}
