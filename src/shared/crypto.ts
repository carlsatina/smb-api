import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { env } from '../config/env';

// AES-256-GCM symmetric encryption for secrets at rest (e.g. third-party API keys).
// The 32-byte key is derived from AI_ENCRYPTION_KEY when set, otherwise from
// ACCESS_TOKEN_SECRET so development works without extra configuration.
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard nonce length

let cachedKey: Buffer | null = null;

const getKey = (): Buffer => {
    if (cachedKey) return cachedKey;
    const secret = env.aiEncryptionKey || env.accessTokenSecret;
    // Fixed salt: keeps the derived key stable across restarts so previously
    // encrypted values remain decryptable.
    cachedKey = scryptSync(secret, 'arshii.secret.encryption.v1', 32);
    return cachedKey;
};

/**
 * Encrypts a plaintext secret. Returns a self-describing string of the form
 * `iv:authTag:ciphertext` (all base64), suitable for storing in a single column.
 */
export const encryptSecret = (plaintext: string): string => {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, getKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':');
};

/**
 * Decrypts a value produced by `encryptSecret`. Returns null if the payload is
 * malformed or fails authentication (e.g. wrong key / tampered data).
 */
export const decryptSecret = (payload: string): string | null => {
    try {
        const [ivB64, tagB64, dataB64] = payload.split(':');
        if (!ivB64 || !tagB64 || !dataB64) return null;
        const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
        const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
        return decrypted.toString('utf8');
    } catch {
        return null;
    }
};
