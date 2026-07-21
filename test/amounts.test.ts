import { describe, it, expect } from "vitest"
import {
  getCurrencyExponent,
  toAmountNumber,
  formatAmountForPayPal,
} from "../src/modules/paypal/utils/amounts"

describe("getCurrencyExponent", () => {
  it("returns 2 for standard currencies", () => {
    expect(getCurrencyExponent("USD")).toBe(2)
    expect(getCurrencyExponent("EUR")).toBe(2)
    expect(getCurrencyExponent("GBP")).toBe(2)
  })

  it("returns 0 for zero-decimal currencies", () => {
    expect(getCurrencyExponent("JPY")).toBe(0)
    expect(getCurrencyExponent("KRW")).toBe(0)
    expect(getCurrencyExponent("VND")).toBe(0)
  })

  it("treats HUF and TWD as zero-decimal (PayPal quirk)", () => {
    // ISO 4217 says these have 2 minor digits, but PayPal rejects decimals.
    expect(getCurrencyExponent("HUF")).toBe(0)
    expect(getCurrencyExponent("TWD")).toBe(0)
  })

  it("returns 3 for three-decimal currencies", () => {
    expect(getCurrencyExponent("BHD")).toBe(3)
    expect(getCurrencyExponent("KWD")).toBe(3)
    expect(getCurrencyExponent("OMR")).toBe(3)
  })

  it("is case-insensitive", () => {
    expect(getCurrencyExponent("jpy")).toBe(0)
    expect(getCurrencyExponent("bhd")).toBe(3)
    expect(getCurrencyExponent("usd")).toBe(2)
  })

  it("defaults unknown currencies to 2", () => {
    expect(getCurrencyExponent("ZZZ")).toBe(2)
  })
})

describe("toAmountNumber", () => {
  it("returns 0 for null / undefined", () => {
    expect(toAmountNumber(null)).toBe(0)
    expect(toAmountNumber(undefined)).toBe(0)
  })

  it("passes through finite numbers", () => {
    expect(toAmountNumber(10)).toBe(10)
    expect(toAmountNumber(0)).toBe(0)
    expect(toAmountNumber(19.99)).toBe(19.99)
  })

  it("throws on non-finite numbers", () => {
    expect(() => toAmountNumber(NaN)).toThrow(/non-finite/)
    expect(() => toAmountNumber(Infinity)).toThrow(/non-finite/)
    expect(() => toAmountNumber(-Infinity)).toThrow(/non-finite/)
  })

  it("parses numeric strings", () => {
    expect(toAmountNumber("20")).toBe(20)
    expect(toAmountNumber("19.99")).toBe(19.99)
  })

  it("throws on unparseable strings", () => {
    expect(() => toAmountNumber("abc")).toThrow(/unparseable string/)
  })

  it("throws on blank strings instead of silently returning 0", () => {
    // Number("") === 0 — a blank amount must not become a zero (full-refund) amount.
    expect(() => toAmountNumber("")).toThrow(/unparseable string/)
    expect(() => toAmountNumber("   ")).toThrow(/unparseable string/)
  })

  it("throws on a blank BigNumber value instead of returning 0", () => {
    expect(() => toAmountNumber({ value: "" })).toThrow(/unparseable BigNumber value/)
    expect(() => toAmountNumber({ value: "  " })).toThrow(/unparseable BigNumber value/)
  })

  it("reads a Medusa BigNumber instance (numeric getter)", () => {
    expect(toAmountNumber({ numeric: 42.5 })).toBe(42.5)
  })

  it("reads a serialized BigNumber raw form { value }", () => {
    expect(toAmountNumber({ value: "20", precision: 20 })).toBe(20)
    expect(toAmountNumber({ value: "19.99" })).toBe(19.99)
  })

  it("throws on unparseable BigNumber value (never silently 0)", () => {
    // Regression guard: a silent 0 here turns a partial refund into a full one.
    expect(() => toAmountNumber({ value: "not-a-number" })).toThrow(
      /unparseable BigNumber value/
    )
  })

  it("throws on unrecognized object shapes", () => {
    expect(() => toAmountNumber({ foo: "bar" })).toThrow(/unrecognized type/)
  })
})

describe("formatAmountForPayPal", () => {
  it("formats standard currencies to 2 decimals", () => {
    expect(formatAmountForPayPal(10, "USD")).toBe("10.00")
    expect(formatAmountForPayPal(19.9, "EUR")).toBe("19.90")
    expect(formatAmountForPayPal(19.999, "EUR")).toBe("20.00")
  })

  it("formats zero-decimal currencies without decimals", () => {
    expect(formatAmountForPayPal(1000, "JPY")).toBe("1000")
    expect(formatAmountForPayPal(1000, "HUF")).toBe("1000")
    expect(formatAmountForPayPal(1000.4, "TWD")).toBe("1000")
  })

  it("formats three-decimal currencies", () => {
    expect(formatAmountForPayPal(10, "KWD")).toBe("10.000")
    expect(formatAmountForPayPal(1.5, "BHD")).toBe("1.500")
  })

  it("throws on non-finite amounts", () => {
    expect(() => formatAmountForPayPal(NaN, "USD")).toThrow()
    expect(() => formatAmountForPayPal(Infinity, "USD")).toThrow()
  })
})
