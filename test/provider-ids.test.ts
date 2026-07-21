import { describe, it, expect } from "vitest"
import {
  PAYPAL_WALLET_PROVIDER_ID,
  PAYPAL_CARD_PROVIDER_ID,
  PAYPAL_PROVIDER_IDS,
  isPayPalProviderId,
} from "../src/modules/paypal/utils/provider-ids"

describe("provider ids", () => {
  it("exposes the wallet and card ids in the list", () => {
    expect(PAYPAL_PROVIDER_IDS).toContain(PAYPAL_WALLET_PROVIDER_ID)
    expect(PAYPAL_PROVIDER_IDS).toContain(PAYPAL_CARD_PROVIDER_ID)
  })

  it("recognizes PayPal provider ids", () => {
    expect(isPayPalProviderId(PAYPAL_WALLET_PROVIDER_ID)).toBe(true)
    expect(isPayPalProviderId(PAYPAL_CARD_PROVIDER_ID)).toBe(true)
  })

  it("rejects non-PayPal and empty ids", () => {
    expect(isPayPalProviderId("pp_stripe_stripe")).toBe(false)
    expect(isPayPalProviderId("")).toBe(false)
    expect(isPayPalProviderId(null)).toBe(false)
    expect(isPayPalProviderId(undefined)).toBe(false)
  })
})
