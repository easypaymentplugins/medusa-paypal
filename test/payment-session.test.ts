import { describe, it, expect } from "vitest"
import { getStoredPayPalOrderId } from "../src/modules/paypal/utils/payment-session"

describe("getStoredPayPalOrderId", () => {
  it("reads the canonical data.paypal.order_id", () => {
    expect(getStoredPayPalOrderId({ paypal: { order_id: "ORDER1" } })).toBe("ORDER1")
  })

  it("reads the legacy top-level data.order_id", () => {
    expect(getStoredPayPalOrderId({ order_id: "ORDER2" })).toBe("ORDER2")
  })

  it("prefers the canonical location over the legacy one", () => {
    expect(
      getStoredPayPalOrderId({ order_id: "LEGACY", paypal: { order_id: "CANON" } })
    ).toBe("CANON")
  })

  it("returns null when no order id is present", () => {
    expect(getStoredPayPalOrderId({})).toBeNull()
    expect(getStoredPayPalOrderId(null)).toBeNull()
    expect(getStoredPayPalOrderId(undefined)).toBeNull()
    expect(getStoredPayPalOrderId({ paypal: {} })).toBeNull()
  })
})
