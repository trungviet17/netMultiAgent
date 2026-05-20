import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

function loadEncryptionKey(): Buffer {
  const raw = process.env.INKEEP_AGENTS_PROVIDER_CREDENTIALS_KEY;
  if (!raw) {
    throw new Error(
      'INKEEP_AGENTS_PROVIDER_CREDENTIALS_KEY is not set. Generate one with `openssl rand -hex 32`.'
    );
  }

  let key: Buffer;
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === KEY_LENGTH * 2) {
    key = Buffer.from(raw, 'hex');
  } else if (/^[A-Za-z0-9+/=]+$/.test(raw)) {
    key = Buffer.from(raw, 'base64');
  } else {
    key = Buffer.from(raw, 'utf8');
  }

  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `INKEEP_AGENTS_PROVIDER_CREDENTIALS_KEY must decode to ${KEY_LENGTH} bytes (got ${key.length}).`
    );
  }
  return key;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encryptSecret requires a non-empty string');
  }
  const key = loadEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export function decryptSecret(encrypted: EncryptedSecret): string {
  if (!encrypted?.ciphertext || !encrypted?.iv || !encrypted?.authTag) {
    throw new Error('decryptSecret requires ciphertext, iv, and authTag');
  }
  const key = loadEncryptionKey();
  const iv = Buffer.from(encrypted.iv, 'base64');
  const authTag = Buffer.from(encrypted.authTag, 'base64');
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid auth tag length');
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 8) return '••••';
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}
