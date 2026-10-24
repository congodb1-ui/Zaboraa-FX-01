import crypto from 'crypto';
import { getOrSetPerInstallSalt } from './db';

let derivedMasterKey: Buffer | null = null;
let hasLoggedMasterKeyWarning = false;

/**
 * Reset cached key (useful for unit testing different environment states)
 */
export function _resetMasterKeyForTest(): void {
  derivedMasterKey = null;
  hasLoggedMasterKeyWarning = false;
}

/**
 * Initializes the master encryption key derived once at startup via scrypt.
 * Refuses to start if ENCRYPTION_MASTER_KEY is missing, unless in NODE_ENV=development
 * with ALLOW_EPHEMERAL_KEY=true.
 */
export function initMasterKey(): Buffer {
  if (derivedMasterKey) return derivedMasterKey;

  const rawKey = process.env.ENCRYPTION_MASTER_KEY;
  if (!rawKey) {
    const isDev = process.env.NODE_ENV === 'development';
    const allowEphemeral = process.env.ALLOW_EPHEMERAL_KEY === 'true';

    if (!isDev || !allowEphemeral) {
      throw new Error(
        'CRITICAL_SECURITY_HALT: ENCRYPTION_MASTER_KEY is not configured. Server refuses to start. ' +
        'To allow an ephemeral key for local development only, set NODE_ENV=development and ALLOW_EPHEMERAL_KEY=true in .env.'
      );
    }

    if (!hasLoggedMasterKeyWarning) {
      console.warn(
        '\n====================================================================\n' +
        '[LOUD SECURITY WARNING] ENCRYPTION_MASTER_KEY is NOT set in environment!\n' +
        'Running with an ephemeral key because NODE_ENV=development and ALLOW_EPHEMERAL_KEY=true.\n' +
        'DO NOT USE IN PRODUCTION OR WITH REAL BROKER CREDENTIALS!\n' +
        '====================================================================\n'
      );
      hasLoggedMasterKeyWarning = true;
    }
  }

  const salt = getOrSetPerInstallSalt();
  const passphrase = rawKey || 'zaboraa-ephemeral-dev-master-passphrase-2026';
  derivedMasterKey = crypto.scryptSync(passphrase, salt, 32);
  return derivedMasterKey;
}

/**
 * Encrypts a plaintext string using AES-256-GCM with a random 12-byte IV per record.
 * Formats payload with explicit version prefix: v1:iv:authTag:encrypted
 */
export function encryptSecret(plainText: string): string {
  const key = initMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts an encrypted payload using AES-256-GCM.
 * Supports versioned format (v1:iv:authTag:encrypted) as well as legacy 3-part payloads.
 */
export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  let ivHex: string;
  let authTagHex: string;
  let encryptedHex: string;

  if (parts.length === 4 && parts[0] === 'v1') {
    [, ivHex, authTagHex, encryptedHex] = parts;
  } else if (parts.length === 3) {
    [ivHex, authTagHex, encryptedHex] = parts;
  } else {
    throw new Error('Invalid encrypted payload format. Expected v1:iv:authTag:encrypted');
  }

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
 * Generates a SHA-256 hash of arbitrary content
 */
export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}
