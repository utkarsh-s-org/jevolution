import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function encryptionKey(secret: string) {
  const key = Buffer.from(secret, 'base64');
  if (key.length !== 32 || key.toString('base64') !== secret)
    throw new Error('Account key encryption requires a 32-byte base64 secret.');
  return key;
}
function context(userId: string, provider: string) {
  if (!userId || !provider) throw new Error('Account and provider are required.');
  return Buffer.from(JSON.stringify(['jevolution-provider-key-v1', userId, provider]));
}

// The encryption secret must live outside the users database. Never return a
// decrypted key to the browser; use it only for a server-to-provider request.
export function encryptAccountKey(secret: string, userId: string, provider: string, value: string) {
  if (!value || value.length > 4096 || /[^\x21-\x7e]/.test(value))
    throw new Error('Invalid provider key.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  cipher.setAAD(context(userId, provider));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}
export function decryptAccountKey(
  secret: string,
  userId: string,
  provider: string,
  record: string,
) {
  const [version, nonce, tag, ciphertext, extra] = record.split('.');
  if (
    version !== 'v1' ||
    !nonce ||
    !tag ||
    !ciphertext ||
    extra !== undefined ||
    record.length > 6000
  )
    throw new Error('Invalid encrypted provider key.');
  const iv = Buffer.from(nonce, 'base64');
  const authTag = Buffer.from(tag, 'base64');
  if (iv.length !== 12 || authTag.length !== 16) throw new Error('Invalid encrypted provider key.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), iv);
  decipher.setAAD(context(userId, provider));
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
