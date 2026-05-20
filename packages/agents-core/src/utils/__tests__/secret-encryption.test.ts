import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, maskSecret } from '../secret-encryption';

const VALID_HEX_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('secret-encryption', () => {
  const original = process.env.INKEEP_AGENTS_PROVIDER_CREDENTIALS_KEY;
  beforeEach(() => {
    process.env.INKEEP_AGENTS_PROVIDER_CREDENTIALS_KEY = VALID_HEX_KEY;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.INKEEP_AGENTS_PROVIDER_CREDENTIALS_KEY;
    else process.env.INKEEP_AGENTS_PROVIDER_CREDENTIALS_KEY = original;
  });

  it('round-trips a secret', () => {
    const enc = encryptSecret('sk-very-secret-key');
    expect(enc.ciphertext).not.toContain('sk-');
    expect(enc.iv).toBeTruthy();
    expect(enc.authTag).toBeTruthy();
    expect(decryptSecret(enc)).toBe('sk-very-secret-key');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encryptSecret('hello');
    const b = encryptSecret('hello');
    expect(a.ciphertext).not.toEqual(b.ciphertext);
    expect(a.iv).not.toEqual(b.iv);
  });

  it('throws if auth tag is tampered with', () => {
    const enc = encryptSecret('hello');
    const tampered = { ...enc, authTag: Buffer.alloc(16, 0).toString('base64') };
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('throws when key env var is missing', () => {
    delete process.env.INKEEP_AGENTS_PROVIDER_CREDENTIALS_KEY;
    expect(() => encryptSecret('x')).toThrow(/INKEEP_AGENTS_PROVIDER_CREDENTIALS_KEY/);
  });

  it('throws on wrong key length', () => {
    process.env.INKEEP_AGENTS_PROVIDER_CREDENTIALS_KEY = 'tooshort';
    expect(() => encryptSecret('x')).toThrow(/32 bytes/);
  });

  it('rejects empty plaintext', () => {
    expect(() => encryptSecret('')).toThrow();
  });

  it('masks short and long secrets', () => {
    expect(maskSecret('abc')).toBe('••••');
    expect(maskSecret('sk-1234567890abcdef')).toBe('sk-1••••cdef');
  });
});
