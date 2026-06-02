import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto"

/**
 * Opt-in encryption-at-rest for PayPal secrets (client secret, app access
 * token).
 *
 * Activated only when `PAYPAL_ENCRYPTION_KEY` is set. When it is unset (the
 * default), both functions are the identity — behavior is byte-for-byte
 * unchanged, so existing deployments are unaffected.
 *
 * Format: `enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>` using AES-256-GCM
 * (authenticated, so tampering is detected on decrypt). Legacy plaintext values
 * (no prefix) are returned as-is on decrypt, so secrets stored before
 * encryption was enabled keep working and are upgraded on the next save.
 */
const PREFIX = "enc:v1:"

let cachedRaw: string | undefined
let cachedKey: Buffer | null = null

/**
 * `@types/node` 22.0-22.6 typed `Buffer` as `Buffer<ArrayBufferLike>`, which is
 * rejected where the `crypto` APIs and `Buffer.concat` expect a plain
 * `Uint8Array` (the regression was fixed in 22.8). Narrowing each byte view to
 * `Uint8Array` at the call boundary sidesteps it without changing runtime
 * behavior, and stays valid on every other `@types/node` / TypeScript version.
 */
const bytes = (view: Buffer): Uint8Array => view as unknown as Uint8Array

function getKey(): Buffer | null {
  const raw = (process.env.PAYPAL_ENCRYPTION_KEY || "").trim()
  if (raw !== cachedRaw) {
    cachedRaw = raw
    // Accept a key of any length/format; derive a stable 32-byte AES key.
    cachedKey = raw ? createHash("sha256").update(raw).digest() : null
  }
  return cachedKey
}

export function isSecretEncryptionEnabled(): boolean {
  return getKey() !== null
}

export function isEncrypted(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(PREFIX)
}

/**
 * Encrypt a secret for storage. Returns the input unchanged when no key is
 * configured or when the value is empty/already encrypted.
 */
export function encryptSecret<T extends string | null | undefined>(value: T): T | string {
  if (!value) {
    return value
  }
  const key = getKey()
  if (!key || isEncrypted(value)) {
    return value
  }
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", bytes(key), bytes(iv))
  const ciphertext = Buffer.concat([bytes(cipher.update(String(value), "utf8")), bytes(cipher.final())])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`
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
  const key = getKey()
  if (!key) {
    throw new Error(
      "PayPal secret is encrypted but PAYPAL_ENCRYPTION_KEY is not set. Restore the key to decrypt stored credentials."
    )
  }
  const body = String(value).slice(PREFIX.length)
  const [ivB64, tagB64, ctB64] = body.split(":")
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error("PayPal secret ciphertext is malformed.")
  }
  const decipher = createDecipheriv("aes-256-gcm", bytes(key), bytes(Buffer.from(ivB64, "base64")))
  decipher.setAuthTag(bytes(Buffer.from(tagB64, "base64")))
  const plaintext = Buffer.concat([
    bytes(decipher.update(bytes(Buffer.from(ctB64, "base64")))),
    bytes(decipher.final()),
  ])
  return plaintext.toString("utf8")
}
