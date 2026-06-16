import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/shared/crypto';

describe('crypto secret encryption', () => {
    const secret = 'sk-ant-api03-EXAMPLE-key-1234567890';

    it('round-trips an encrypted secret', () => {
        const encrypted = encryptSecret(secret);
        expect(decryptSecret(encrypted)).toBe(secret);
    });

    it('does not store the plaintext in the ciphertext', () => {
        const encrypted = encryptSecret(secret);
        expect(encrypted.includes(secret)).toBe(false);
    });

    it('produces a different ciphertext each time (random IV)', () => {
        expect(encryptSecret(secret)).not.toBe(encryptSecret(secret));
    });

    it('returns null for malformed or tampered payloads', () => {
        expect(decryptSecret('not-a-valid-payload')).toBeNull();
        expect(decryptSecret('aaa:bbb:ccc')).toBeNull();
    });
});
