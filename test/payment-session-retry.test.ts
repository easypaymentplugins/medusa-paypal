import { describe, it, expect, vi, afterEach } from "vitest"
import { updatePayPalSessionData } from "../src/modules/paypal/utils/payment-session"

function makeScope(paymentModule: any) {
  return { resolve: vi.fn().mockReturnValue(paymentModule) }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("updatePayPalSessionData", () => {
  it("retries a transient failure and succeeds", async () => {
    vi.useFakeTimers()
    const updatePaymentSession = vi
      .fn()
      .mockRejectedValueOnce(new Error("deadlock"))
      .mockResolvedValueOnce(undefined)
    const paymentModule = {
      listPaymentSessions: vi.fn().mockResolvedValue([
        { id: "ps_1", data: { existing: true }, amount: 100, currency_code: "eur" },
      ]),
      updatePaymentSession,
    }

    const p = updatePayPalSessionData("ps_1", { paypal: { capture_id: "CAP1" } }, makeScope(paymentModule))
    await vi.runAllTimersAsync()
    await expect(p).resolves.toBeUndefined()

    expect(updatePaymentSession).toHaveBeenCalledTimes(2)
    // Merges new data over existing session data.
    const arg = updatePaymentSession.mock.calls[1][0]
    expect(arg.data).toMatchObject({ existing: true, paypal: { capture_id: "CAP1" } })
  })

  it("throws after exhausting all retries", async () => {
    vi.useFakeTimers()
    const updatePaymentSession = vi.fn().mockRejectedValue(new Error("db down"))
    const paymentModule = {
      listPaymentSessions: vi.fn().mockResolvedValue([{ id: "ps_1", data: {} }]),
      updatePaymentSession,
    }

    const p = updatePayPalSessionData("ps_1", { order_id: "O1" }, makeScope(paymentModule))
    const assertion = expect(p).rejects.toThrow(/db down/)
    await vi.runAllTimersAsync()
    await assertion

    // 3 attempts total.
    expect(updatePaymentSession).toHaveBeenCalledTimes(3)
  })

  it("succeeds on the first attempt without waiting", async () => {
    const updatePaymentSession = vi.fn().mockResolvedValue(undefined)
    const paymentModule = {
      listPaymentSessions: vi.fn().mockResolvedValue([{ id: "ps_1", data: {} }]),
      updatePaymentSession,
    }

    await expect(
      updatePayPalSessionData("ps_1", { paypal: {} }, makeScope(paymentModule))
    ).resolves.toBeUndefined()
    expect(updatePaymentSession).toHaveBeenCalledTimes(1)
  })
})
