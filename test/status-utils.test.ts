import { describe, it, expect } from "vitest"
import {
  mapPayPalCaptureStatus,
  extractCaptureStatus,
  isCaptureCompleted,
  isRefundFailureStatus,
} from "../src/modules/paypal/payment-provider/status-utils"

describe("mapPayPalCaptureStatus", () => {
  it("maps COMPLETED to captured", () => {
    expect(mapPayPalCaptureStatus("COMPLETED")).toBe("captured")
    expect(mapPayPalCaptureStatus("completed")).toBe("captured")
  })

  it("maps PENDING to pending", () => {
    expect(mapPayPalCaptureStatus("PENDING")).toBe("pending")
  })

  it("maps decline/failure statuses to error", () => {
    expect(mapPayPalCaptureStatus("DENIED")).toBe("error")
    expect(mapPayPalCaptureStatus("DECLINED")).toBe("error")
    expect(mapPayPalCaptureStatus("FAILED")).toBe("error")
  })

  it("keeps a partially refunded capture as captured", () => {
    // Only a portion was returned — the capture is still live.
    expect(mapPayPalCaptureStatus("PARTIALLY_REFUNDED")).toBe("captured")
  })

  it("maps full refund / reversal to canceled", () => {
    expect(mapPayPalCaptureStatus("REFUNDED")).toBe("canceled")
    expect(mapPayPalCaptureStatus("REVERSED")).toBe("canceled")
  })

  it("returns null for empty / unknown statuses", () => {
    expect(mapPayPalCaptureStatus("")).toBeNull()
    expect(mapPayPalCaptureStatus(undefined)).toBeNull()
    expect(mapPayPalCaptureStatus("SOMETHING_ELSE")).toBeNull()
  })
})

describe("extractCaptureStatus", () => {
  it("prefers the nested purchase_units capture status", () => {
    const resource = {
      status: "COMPLETED",
      purchase_units: [
        { payments: { captures: [{ status: "PENDING" }] } },
      ],
    }
    // Order status can read COMPLETED while the capture is still PENDING.
    expect(extractCaptureStatus(resource)).toBe("PENDING")
  })

  it("falls back to the top-level status (authorizations-capture shape)", () => {
    expect(extractCaptureStatus({ status: "completed" })).toBe("COMPLETED")
  })

  it("returns empty string for non-objects", () => {
    expect(extractCaptureStatus(null)).toBe("")
    expect(extractCaptureStatus(undefined)).toBe("")
    expect(extractCaptureStatus("x")).toBe("")
  })
})

describe("isCaptureCompleted", () => {
  it("is true only for COMPLETED", () => {
    expect(isCaptureCompleted({ status: "COMPLETED" })).toBe(true)
  })

  it("is false for a 2xx PENDING/DECLINED capture", () => {
    // PayPal returns 201 for PENDING/DECLINED/FAILED — must not book those.
    expect(isCaptureCompleted({ status: "PENDING" })).toBe(false)
    expect(isCaptureCompleted({ status: "DECLINED" })).toBe(false)
    expect(
      isCaptureCompleted({
        status: "COMPLETED",
        purchase_units: [{ payments: { captures: [{ status: "PENDING" }] } }],
      })
    ).toBe(false)
  })
})

describe("isRefundFailureStatus", () => {
  it("flags failure statuses (both CANCELLED spellings)", () => {
    expect(isRefundFailureStatus("FAILED")).toBe(true)
    expect(isRefundFailureStatus("CANCELLED")).toBe(true)
    expect(isRefundFailureStatus("CANCELED")).toBe(true)
    expect(isRefundFailureStatus("DENIED")).toBe(true)
  })

  it("does not flag PENDING (async settlement) or COMPLETED", () => {
    expect(isRefundFailureStatus("PENDING")).toBe(false)
    expect(isRefundFailureStatus("COMPLETED")).toBe(false)
    expect(isRefundFailureStatus(undefined)).toBe(false)
  })
})
