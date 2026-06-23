import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'crypto';

/**
 * AES-256-GCM encryption for mailbox credentials.
 * Key comes from CREDENTIAL_ENCRYPTION_KEY (base64-encoded 32 bytes).
 * Output format: base64(iv).base64(authTag).base64(ciphertext)
 */
const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY ?? '';
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
    );
  }
  return key;
}

export function encryptCredential(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}

export function decryptCredential(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted credential');
  }
  const decipher = createDecipheriv(
    ALGO,
    getKey(),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
