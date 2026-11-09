import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encrypts secrets kept in the database (each person's Pluggy key, for the Open Finance) with
 * AES-256-GCM and ENCRYPTION_KEY: 32 random bytes in base64, one per environment. A database
 * backup alone doesn't give access to anyone's banks. Changing the key means saving the key again.
 */

const VERSION = 'v1';

function encryptionKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

export function canEncryptSecrets(): boolean {
  return encryptionKey() !== null;
}

export class SecretKeyMissingError extends Error {
  constructor() {
    super('ENCRYPTION_KEY ausente ou inválida (precisa de 32 bytes em base64).');
    this.name = 'SecretKeyMissingError';
  }
}

/** "v1.<iv>.<tag>.<ciphertext>", all base64url. */
export function encryptSecret(plain: string): string {
  const key = encryptionKey();
  if (!key) throw new SecretKeyMissingError();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

/** Throws when the key is missing or different, or the value was tampered with. */
export function decryptSecret(sealed: string): string {
  const key = encryptionKey();
  if (!key) throw new SecretKeyMissingError();
  const [version, iv, tag, ciphertext] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
    throw new Error('Segredo em formato desconhecido.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString(
    'utf8',
  );
}
