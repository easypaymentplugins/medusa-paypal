import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  encryptSecret,
  decryptSecret,
  isEncrypted,
  isSecretEncryptionEnabled,
} from "../src/modules/paypal/utils/secret-crypto"

const KEY = "test-encryption-key-please-change"

describe("secret-crypto (encryption disabled)", () => {
  beforeEach(() => {
    delete process.env.PAYPAL_ENCRYPTION_KEY
  })

  it("reports encryption disabled without a key", () => {
    expect(isSecretEncryptionEnabled()).toBe(false)
  })

  it("is the identity on encrypt/decrypt when no key is set", () => {
    expect(encryptSecret("secret-value")).toBe("secret-value")
    expect(decryptSecret("secret-value")).toBe("secret-value")
  })

  it("preserves null / undefined / empty", () => {
    expect(encryptSecret(null)).toBeNull()
    expect(encryptSecret(undefined)).toBeUndefined()
    expect(encryptSecret("")).toBe("")
  })
})

describe("secret-crypto (encryption enabled)", () => {
  beforeEach(() => {
    process.env.PAYPAL_ENCRYPTION_KEY = KEY
  })
  afterEach(() => {
    delete process.env.PAYPAL_ENCRYPTION_KEY
  })

  it("reports encryption enabled with a key", () => {
    expect(isSecretEncryptionEnabled()).toBe(true)
  })

  it("round-trips a secret through v2 format", () => {
    const enc = encryptSecret("client-secret-123") as string
    expect(enc).not.toBe("client-secret-123")
    expect(enc.startsWith("enc:v2:")).toBe(true)
    expect(isEncrypted(enc)).toBe(true)
    expect(decryptSecret(enc)).toBe("client-secret-123")
  })

  it("produces a unique ciphertext per call (random salt + iv)", () => {
    const a = encryptSecret("same-value") as string
    const b = encryptSecret("same-value") as string
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe("same-value")
    expect(decryptSecret(b)).toBe("same-value")
  })

  it("does not double-encrypt an already-encrypted value", () => {
    const enc = encryptSecret("v") as string
    expect(encryptSecret(enc)).toBe(enc)
  })

  it("leaves legacy plaintext (no prefix) unchanged on decrypt", () => {
    expect(decryptSecret("plain-legacy-value")).toBe("plain-legacy-value")
  })

  it("throws on a tampered / wrong-key ciphertext", () => {
    const enc = encryptSecret("tamper-me") as string
    // Flip the last base64 char of the ciphertext segment.
    const parts = enc.split(":")
    const last = parts[parts.length - 1]
    parts[parts.length - 1] = last[0] === "A" ? "B" + last.slice(1) : "A" + last.slice(1)
    const tampered = parts.join(":")
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it("throws a clear error when a v2 payload is malformed", () => {
    expect(() => decryptSecret("enc:v2:onlyonepart")).toThrow(/malformed/)
  })
})

describe("secret-crypto: encrypted value but key removed", () => {
  it("throws a helpful error when the key is gone", () => {
    process.env.PAYPAL_ENCRYPTION_KEY = KEY
    const enc = encryptSecret("needs-key") as string
    delete process.env.PAYPAL_ENCRYPTION_KEY
    expect(() => decryptSecret(enc)).toThrow(/PAYPAL_ENCRYPTION_KEY is not set/)
  })
})

describe("isEncrypted", () => {
  it("recognizes v1 and v2 prefixes", () => {
    expect(isEncrypted("enc:v2:a:b:c:d")).toBe(true)
    expect(isEncrypted("enc:v1:a:b:c")).toBe(true)
  })
  it("rejects plaintext and non-strings", () => {
    expect(isEncrypted("plain")).toBe(false)
    expect(isEncrypted(null)).toBe(false)
    expect(isEncrypted(123)).toBe(false)
  })
})
