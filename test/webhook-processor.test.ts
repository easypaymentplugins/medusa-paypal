import { describe, it, expect } from "vitest"
import {
  EVENT_STATUS_MAP,
  isTransitionAllowed,
  isAllowedEventType,
  isRetryableError,
  computeNextRetryAt,
  normalizeResource,
  normalizeEventVersion,
  extractIdentifiers,
  extractCaptureIdFromLinks,
  isPartialRefund,
  MAX_WEBHOOK_ATTEMPTS,
} from "../src/modules/paypal/webhook-processor"

describe("EVENT_STATUS_MAP", () => {
  it("maps the core capture / order / refund events", () => {
    expect(EVENT_STATUS_MAP["CHECKOUT.ORDER.APPROVED"]).toBe("authorized")
    expect(EVENT_STATUS_MAP["PAYMENT.CAPTURE.COMPLETED"]).toBe("captured")
    expect(EVENT_STATUS_MAP["PAYMENT.CAPTURE.DENIED"]).toBe("error")
    expect(EVENT_STATUS_MAP["PAYMENT.CAPTURE.REFUNDED"]).toBe("canceled")
    expect(EVENT_STATUS_MAP["PAYMENT.REFUND.COMPLETED"]).toBe("canceled")
  })
})

describe("isTransitionAllowed", () => {
  it("allows forward progress from pending", () => {
    expect(isTransitionAllowed("pending", "authorized")).toBe(true)
    expect(isTransitionAllowed("pending", "captured")).toBe(true)
    expect(isTransitionAllowed("authorized", "captured")).toBe(true)
    expect(isTransitionAllowed("captured", "canceled")).toBe(true)
  })

  it("blocks backward / invalid transitions", () => {
    // Once captured you cannot go back to authorized.
    expect(isTransitionAllowed("captured", "authorized")).toBe(false)
    // A canceled payment is terminal.
    expect(isTransitionAllowed("canceled", "captured")).toBe(false)
    expect(isTransitionAllowed("canceled", "authorized")).toBe(false)
  })

  it("returns false for unknown source states", () => {
    expect(isTransitionAllowed("bogus", "captured")).toBe(false)
  })
})

describe("isAllowedEventType", () => {
  it("accepts supported prefixes", () => {
    expect(isAllowedEventType("PAYMENT.CAPTURE.COMPLETED")).toBe(true)
    expect(isAllowedEventType("CHECKOUT.ORDER.APPROVED")).toBe(true)
    expect(isAllowedEventType("PAYMENT.AUTHORIZATION.CREATED")).toBe(true)
    expect(isAllowedEventType("PAYMENT.REFUND.COMPLETED")).toBe(true)
  })

  it("rejects unrelated event types", () => {
    expect(isAllowedEventType("BILLING.SUBSCRIPTION.CREATED")).toBe(false)
    expect(isAllowedEventType("SOMETHING.ELSE")).toBe(false)
  })
})

describe("isRetryableError", () => {
  it("classifies not-found / missing-session errors as non-retryable", () => {
    expect(isRetryableError(new Error("payment collection not found for cart x"))).toBe(false)
    expect(isRetryableError(new Error("no paypal session found"))).toBe(false)
    expect(isRetryableError(new Error("session not found"))).toBe(false)
    expect(isRetryableError(new Error("cart not found"))).toBe(false)
  })

  it("treats transient / unknown errors as retryable", () => {
    expect(isRetryableError(new Error("PayPal API 503"))).toBe(true)
    expect(isRetryableError(new Error("network timeout"))).toBe(true)
    expect(isRetryableError("some string error")).toBe(true)
  })

  it("is case-insensitive", () => {
    expect(isRetryableError(new Error("CART NOT FOUND"))).toBe(false)
  })
})

describe("computeNextRetryAt", () => {
  it("returns a future date for the first attempts", () => {
    const now = Date.now()
    const next = computeNextRetryAt(1)
    expect(next).toBeInstanceOf(Date)
    expect(next!.getTime()).toBeGreaterThan(now)
  })

  it("increases the delay across the retry schedule", () => {
    const first = computeNextRetryAt(1)!.getTime()
    const second = computeNextRetryAt(2)!.getTime()
    expect(second).toBeGreaterThan(first)
  })

  it("returns null once the schedule is exhausted", () => {
    expect(computeNextRetryAt(MAX_WEBHOOK_ATTEMPTS)).toBeNull()
    expect(computeNextRetryAt(999)).toBeNull()
  })

  it("returns null for non-positive attempt counts", () => {
    expect(computeNextRetryAt(0)).toBeNull()
    expect(computeNextRetryAt(-1)).toBeNull()
  })
})

describe("normalizeResource", () => {
  it("returns the object resource directly", () => {
    expect(normalizeResource({ resource: { id: "x" } })).toEqual({ id: "x" })
  })

  it("parses a stringified JSON resource", () => {
    expect(normalizeResource({ resource: '{"id":"y"}' })).toEqual({ id: "y" })
  })

  it("returns {} for missing or unparseable resource", () => {
    expect(normalizeResource({})).toEqual({})
    expect(normalizeResource({ resource: "not json" })).toEqual({})
  })
})

describe("normalizeEventVersion", () => {
  it("reads and strips a leading v", () => {
    expect(normalizeEventVersion({ event_version: "1.0" })).toBe("1.0")
    expect(normalizeEventVersion({ resource_version: "v2.0" })).toBe("2.0")
  })

  it("reads nested resource version fields", () => {
    expect(normalizeEventVersion({ resource: { resource_version: "3.0" } })).toBe("3.0")
    expect(normalizeEventVersion({ resource: { version: "4.0" } })).toBe("4.0")
  })

  it("returns null when absent", () => {
    expect(normalizeEventVersion({})).toBeNull()
  })
})

describe("extractIdentifiers", () => {
  it("extracts order + cart id from a CHECKOUT.ORDER event", () => {
    const ids = extractIdentifiers(
      {
        id: "ORDER123",
        purchase_units: [
          { custom_id: "cart_abc", payments: { captures: [{ id: "CAP1" }] } },
        ],
      },
      "CHECKOUT.ORDER.APPROVED"
    )
    expect(ids.orderId).toBe("ORDER123")
    expect(ids.cartId).toBe("cart_abc")
    expect(ids.captureId).toBe("CAP1")
  })

  it("extracts capture + order id from a PAYMENT.CAPTURE event", () => {
    const ids = extractIdentifiers(
      {
        id: "CAP99",
        custom_id: "cart_xyz",
        supplementary_data: { related_ids: { order_id: "ORDER99" } },
      },
      "PAYMENT.CAPTURE.COMPLETED"
    )
    expect(ids.captureId).toBe("CAP99")
    expect(ids.orderId).toBe("ORDER99")
    expect(ids.cartId).toBe("cart_xyz")
  })

  it("extracts refund + capture id from a PAYMENT.REFUND event", () => {
    const ids = extractIdentifiers(
      {
        id: "REF1",
        custom_id: "cart_r",
        supplementary_data: {
          related_ids: { order_id: "ORDER1", capture_id: "CAP1" },
        },
      },
      "PAYMENT.REFUND.COMPLETED"
    )
    expect(ids.refundId).toBe("REF1")
    expect(ids.captureId).toBe("CAP1")
    expect(ids.orderId).toBe("ORDER1")
    expect(ids.cartId).toBe("cart_r")
  })

  it("treats a PAYMENT.CAPTURE.REFUNDED resource as a refund (not a capture)", () => {
    // The REFUNDED/REVERSED events carry a *refund* resource: its id is the
    // refund id and the capture is referenced via related_ids / the "up" link.
    const ids = extractIdentifiers(
      {
        id: "REF77",
        custom_id: "cart_ref",
        supplementary_data: { related_ids: { order_id: "ORDER77", capture_id: "CAP77" } },
      },
      "PAYMENT.CAPTURE.REFUNDED"
    )
    expect(ids.refundId).toBe("REF77")
    expect(ids.captureId).toBe("CAP77")
    expect(ids.orderId).toBe("ORDER77")
    expect(ids.cartId).toBe("cart_ref")
  })

  it("falls back to the refund's up-link for the capture id", () => {
    const ids = extractIdentifiers(
      {
        id: "REF88",
        links: [
          { rel: "self", href: "https://api.paypal.com/v2/payments/refunds/REF88" },
          { rel: "up", href: "https://api.paypal.com/v2/payments/captures/CAP88" },
        ],
      },
      "PAYMENT.CAPTURE.REVERSED"
    )
    expect(ids.refundId).toBe("REF88")
    expect(ids.captureId).toBe("CAP88")
  })

  it("returns nulls for missing identifiers", () => {
    const ids = extractIdentifiers({}, "PAYMENT.AUTHORIZATION.CREATED")
    expect(ids.orderId).toBeNull()
    expect(ids.captureId).toBeNull()
    expect(ids.refundId).toBeNull()
    expect(ids.cartId).toBeNull()
  })
})

describe("extractCaptureIdFromLinks", () => {
  it("extracts the capture id from an up link", () => {
    expect(
      extractCaptureIdFromLinks({
        links: [{ rel: "up", href: "https://api.paypal.com/v2/payments/captures/2GG-123" }],
      })
    ).toBe("2GG-123")
  })

  it("returns null when no capture link exists", () => {
    expect(extractCaptureIdFromLinks({ links: [] })).toBeNull()
    expect(extractCaptureIdFromLinks({})).toBeNull()
  })
})

describe("isPartialRefund", () => {
  const session = {
    paypal: { capture: { amount: { value: "100.00", currency_code: "EUR" } } },
  }

  it("detects a partial refund via total_refunded_amount", () => {
    const resource = {
      seller_payable_breakdown: { total_refunded_amount: { value: "40.00" } },
    }
    expect(isPartialRefund(resource, session)).toBe(true)
  })

  it("treats a full refund as full", () => {
    const resource = {
      seller_payable_breakdown: { total_refunded_amount: { value: "100.00" } },
    }
    expect(isPartialRefund(resource, session)).toBe(false)
  })

  it("falls back to the single refund amount", () => {
    expect(isPartialRefund({ amount: { value: "10.00" } }, session)).toBe(true)
  })

  it("treats unknown amounts as a full refund (previous behavior)", () => {
    expect(isPartialRefund({}, session)).toBe(false)
    expect(isPartialRefund({ amount: { value: "10.00" } }, {})).toBe(false)
  })

  it("cumulative refunds that reach the capture amount count as full", () => {
    const resource = {
      amount: { value: "10.00" },
      seller_payable_breakdown: { total_refunded_amount: { value: "100.00" } },
    }
    expect(isPartialRefund(resource, session)).toBe(false)
  })
})
