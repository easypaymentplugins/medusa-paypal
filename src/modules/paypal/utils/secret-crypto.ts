import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "crypto"

/**
 * Opt-in encryption-at-rest for PayPal secrets (client secret, app access
 * token).
 *
 * Activated only when `PAYPAL_ENCRYPTION_KEY` is set. When it is unset (the
 * default), both functions are the identity — behavior is byte-for-byte
 * unchanged, so existing deployments are unaffected.
 *
 * Format (current): `enc:v2:<salt_b64>:<iv_b64>:<tag_b64>:<ciphertext_b64>`
 * using AES-256-GCM with a key derived via **scrypt** over the env key and a
 * random per-secret salt. scrypt is a memory-hard KDF, so even a low-entropy
 * passphrase resists brute-force/rainbow-table attacks (the previous unsalted,
 * single-pass SHA-256 did not).
 *
 * Format (legacy): `enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>` with an
 * unsalted SHA-256 key. Still decryptable so secrets written before the KDF
 * upgrade keep working; they are transparently upgraded to v2 on the next save.
 *
 * Legacy plaintext values (no prefix) are returned as-is on decrypt.
 */
const PREFIX_V2 = "enc:v2:"
const PREFIX_V1 = "enc:v1:"

// scrypt cost parameters. N=2^14 with r=8 needs ~16MB (128*N*r), which stays
// under Node's default 32MB scrypt memory limit while imposing a meaningful
// per-derivation cost. Derived keys are cached, so this runs at most once per
// (env key, salt) pair rather than on every encrypt/decrypt.
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 32
const SALT_LEN = 16

let cachedRaw: string | undefined
let cachedRawKey: string | null = null
let legacyV1Key: Buffer | null = null
const v2KeyCache = new Map<string, Buffer>()

/**
 * `@types/node` 22.0-22.6 typed `Buffer` as `Buffer<ArrayBufferLike>`, which is
 * rejected where the `crypto` APIs and `Buffer.concat` expect a plain
 * `Uint8Array` (the regression was fixed in 22.8). Narrowing each byte view to
 * `Uint8Array` at the call boundary sidesteps it without changing runtime
 * behavior, and stays valid on every other `@types/node` / TypeScript version.
 */
const bytes = (view: Buffer): Uint8Array => view as unknown as Uint8Array

/** The raw env key (trimmed), or null when encryption is disabled. */
function getRawKey(): string | null {
  const raw = (process.env.PAYPAL_ENCRYPTION_KEY || "").trim()
  if (raw !== cachedRaw) {
    cachedRaw = raw
    cachedRawKey = raw || null
    // The unsalted SHA-256 key is only needed to decrypt legacy v1 values.
    legacyV1Key = raw ? createHash("sha256").update(raw).digest() : null
    v2KeyCache.clear()
  }
  return cachedRawKey
}

/** Derive (and cache) the AES key for a v2 secret from the env key + salt. */
function deriveV2Key(raw: string, salt: Buffer): Buffer {
  const cacheKey = `${raw}::${salt.toString("base64")}`
  let key = v2KeyCache.get(cacheKey)
  if (!key) {
    key = scryptSync(raw, bytes(salt), KEY_LEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    })
    v2KeyCache.set(cacheKey, key)
  }
  return key
}

function gcmDecrypt(key: Buffer, ivB64: string, tagB64: string, ctB64: string): string {
  const decipher = createDecipheriv("aes-256-gcm", bytes(key), bytes(Buffer.from(ivB64, "base64")))
  decipher.setAuthTag(bytes(Buffer.from(tagB64, "base64")))
  const plaintext = Buffer.concat([
    bytes(decipher.update(bytes(Buffer.from(ctB64, "base64")))),
    bytes(decipher.final()),
  ])
  return plaintext.toString("utf8")
}

export function isSecretEncryptionEnabled(): boolean {
  return getRawKey() !== null
}

export function isEncrypted(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (value.startsWith(PREFIX_V2) || value.startsWith(PREFIX_V1))
  )
}

/**
 * Encrypt a secret for storage. Returns the input unchanged when no key is
 * configured or when the value is empty/already encrypted. Always writes the
 * current (v2) format.
 */
export function encryptSecret<T extends string | null | undefined>(value: T): T | string {
  if (!value) {
    return value
  }
  const raw = getRawKey()
  if (!raw || isEncrypted(value)) {
    return value
  }
  const salt = randomBytes(SALT_LEN)
  const key = deriveV2Key(raw, salt)
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", bytes(key), bytes(iv))
  const ciphertext = Buffer.concat([bytes(cipher.update(String(value), "utf8")), bytes(cipher.final())])
  const tag = cipher.getAuthTag()
  return `${PREFIX_V2}${salt.toString("base64")}:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`
}

/**
 * Decrypt a stored secret. Returns non-encrypted (legacy plaintext) values
 * unchanged. Throws if the value is encrypted but no key is configured, or if
 * authentication fails (wrong key / tampering).
 */
export function decryptSecret<T extends string | null | undefined>(value: T): T | string {
  if (!value || !isEncrypted(value)) {
    return value
  }
  const raw = getRawKey()
  if (!raw) {
    throw new Error(
      "PayPal secret is encrypted but PAYPAL_ENCRYPTION_KEY is not set. Restore the key to decrypt stored credentials."
    )
  }

  if (String(value).startsWith(PREFIX_V2)) {
    const body = String(value).slice(PREFIX_V2.length)
    const [saltB64, ivB64, tagB64, ctB64] = body.split(":")
    if (!saltB64 || !ivB64 || !tagB64 || !ctB64) {
      throw new Error("PayPal secret ciphertext is malformed.")
    }
    const key = deriveV2Key(raw, Buffer.from(saltB64, "base64"))
    return gcmDecrypt(key, ivB64, tagB64, ctB64)
  }

  // Legacy v1 (unsalted SHA-256 key).
  const body = String(value).slice(PREFIX_V1.length)
  const [ivB64, tagB64, ctB64] = body.split(":")
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error("PayPal secret ciphertext is malformed.")
  }
  if (!legacyV1Key) {
    throw new Error("PayPal secret is encrypted but PAYPAL_ENCRYPTION_KEY is not set.")
  }
  return gcmDecrypt(legacyV1Key, ivB64, tagB64, ctB64)
}
