import { describe, it, expect } from "vitest"
import {
  normalizeCurrencyCode,
  isPayPalCurrencySupported,
  getPayPalCurrencyCompatibility,
  assertPayPalCurrencySupported,
  getPayPalSupportedCurrencies,
} from "../src/modules/paypal/utils/currencies"

describe("normalizeCurrencyCode", () => {
  it("uppercases and trims", () => {
    expect(normalizeCurrencyCode(" usd ")).toBe("USD")
    expect(normalizeCurrencyCode("eur")).toBe("EUR")
  })

  it("falls back when empty/undefined", () => {
    expect(normalizeCurrencyCode(undefined)).toBe("EUR")
    expect(normalizeCurrencyCode("")).toBe("EUR")
    expect(normalizeCurrencyCode("   ")).toBe("EUR")
  })

  it("respects a custom fallback", () => {
    expect(normalizeCurrencyCode(undefined, "USD")).toBe("USD")
  })
})

describe("isPayPalCurrencySupported", () => {
  it("accepts supported currencies", () => {
    expect(isPayPalCurrencySupported("USD")).toBe(true)
    expect(isPayPalCurrencySupported("eur")).toBe(true)
    expect(isPayPalCurrencySupported("JPY")).toBe(true)
  })

  it("rejects unsupported currencies", () => {
    expect(isPayPalCurrencySupported("INR")).toBe(false)
    expect(isPayPalCurrencySupported("AED")).toBe(false)
    expect(isPayPalCurrencySupported("ZZZ")).toBe(false)
  })
})

describe("getPayPalCurrencyCompatibility", () => {
  it("is supported for a plain supported currency", () => {
    const r = getPayPalCurrencyCompatibility({ currencyCode: "usd" })
    expect(r.supported).toBe(true)
    expect(r.currency).toBe("USD")
    expect(r.errors).toEqual([])
  })

  it("flags unsupported currency", () => {
    const r = getPayPalCurrencyCompatibility({ currencyCode: "INR" })
    expect(r.supported).toBe(false)
    expect(r.errors[0]).toMatch(/does not support/)
  })

  it("flags a mismatched override currency", () => {
    const r = getPayPalCurrencyCompatibility({
      currencyCode: "USD",
      paypalCurrencyOverride: "EUR",
    })
    expect(r.supported).toBe(false)
    expect(r.overrideCurrency).toBe("EUR")
    expect(r.errors.some((e) => e.includes("EUR"))).toBe(true)
  })

  it("is supported when override matches the cart currency", () => {
    const r = getPayPalCurrencyCompatibility({
      currencyCode: "usd",
      paypalCurrencyOverride: "USD",
    })
    expect(r.supported).toBe(true)
  })
})

describe("assertPayPalCurrencySupported", () => {
  it("returns the check when supported", () => {
    const r = assertPayPalCurrencySupported({ currencyCode: "USD" })
    expect(r.supported).toBe(true)
  })

  it("throws with joined error messages when unsupported", () => {
    expect(() =>
      assertPayPalCurrencySupported({ currencyCode: "INR" })
    ).toThrow(/does not support/)
  })
})

describe("getPayPalSupportedCurrencies", () => {
  it("returns a non-empty list including common currencies", () => {
    const list = getPayPalSupportedCurrencies()
    expect(Array.isArray(list)).toBe(true)
    expect(list).toContain("USD")
    expect(list).toContain("EUR")
    expect(list.length).toBeGreaterThan(10)
  })
})
