import crypto from 'crypto';

let derivedMasterKey: Buffer | null = null;
let hasLoggedMasterKeyWarning = false;

/**
 * Initializes the master encryption key derived once at startup via scrypt
 */
export function initMasterKey(): Buffer {
  if (derivedMasterKey) return derivedMasterKey;

  const rawKey = process.env.ENCRYPTION_MASTER_KEY;
  if (!rawKey) {
    if (!hasLoggedMasterKeyWarning) {
      console.warn('[SECURITY WARNING] ENCRYPTION_MASTER_KEY not set in environment. Generating local ephemeral key for development.');
      hasLoggedMasterKeyWarning = true;
    }
  }

  const salt = 'zaboraa-fx-salt-v1';
  const passphrase = rawKey || 'zaboraa-ephemeral-dev-master-passphrase-2026';
  derivedMasterKey = crypto.scryptSync(passphrase, salt, 32);
  return derivedMasterKey;
}

/**
 * Encrypts a plaintext string using AES-256-GCM with a random 12-byte IV per record
 */
export function encryptSecret(plainText: string): string {
  const key = initMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Return formatted payload: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts an encrypted payload using AES-256-GCM
 */
export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = initMasterKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Masks a secret string for safe browser transmission and logging (e.g. ••••••••5019)
 */
export function maskSecret(secret: string, visibleSuffixLen = 4): string {
  if (!secret || typeof secret !== 'string') return '';
  if (secret.length <= visibleSuffixLen) return '••••';
  const maskedPrefix = '••••••••';
  const suffix = secret.slice(-visibleSuffixLen);
  return `${maskedPrefix}${suffix}`;
}

/**
 * Generates a SHA-256 hash of arbitrary content (useful for risk limits & idempotency)
 */
export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}
