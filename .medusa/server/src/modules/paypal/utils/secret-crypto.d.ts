export declare function isSecretEncryptionEnabled(): boolean;
export declare function isEncrypted(value: unknown): boolean;
/**
 * Encrypt a secret for storage. Returns the input unchanged when no key is
 * configured or when the value is empty/already encrypted. Always writes the
 * current (v2) format.
 */
export declare function encryptSecret<T extends string | null | undefined>(value: T): T | string;
/**
 * Decrypt a stored secret. Returns non-encrypted (legacy plaintext) values
 * unchanged. Throws if the value is encrypted but no key is configured, or if
 * authentication fails (wrong key / tampering).
 */
export declare function decryptSecret<T extends string | null | undefined>(value: T): T | string;
//# sourceMappingURL=secret-crypto.d.ts.map