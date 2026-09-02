import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Modules } from "@medusajs/framework/utils"

vi.mock("../src/modules/paypal/utils/core-workflow", () => ({
  runCoreWorkflow: vi.fn(),
}))

import { runCoreWorkflow } from "../src/modules/paypal/utils/core-workflow"
import {
  isCartCompletingEventType,
  isWebhookCartCompletionEnabled,
  processPayPalWebhookEvent,
} from "../src/modules/paypal/webhook-processor"

const runCoreWorkflowMock = vi.mocked(runCoreWorkflow)

describe("isWebhookCartCompletionEnabled", () => {
  it("is enabled by default (unset / empty / unrelated values)", () => {
    expect(isWebhookCartCompletionEnabled(undefined)).toBe(true)
    expect(isWebhookCartCompletionEnabled("")).toBe(true)
    expect(isWebhookCartCompletionEnabled("true")).toBe(true)
    expect(isWebhookCartCompletionEnabled("1")).toBe(true)
  })

  it("is disabled by the documented kill-switch values", () => {
    expect(isWebhookCartCompletionEnabled("false")).toBe(false)
    expect(isWebhookCartCompletionEnabled("FALSE")).toBe(false)
    expect(isWebhookCartCompletionEnabled("0")).toBe(false)
    expect(isWebhookCartCompletionEnabled("off")).toBe(false)
    expect(isWebhookCartCompletionEnabled("no")).toBe(false)
  })
})

describe("isCartCompletingEventType", () => {
  it("only settled-funds events may complete a cart", () => {
    expect(isCartCompletingEventType("PAYMENT.CAPTURE.COMPLETED")).toBe(true)
    expect(isCartCompletingEventType("PAYMENT.CAPTURE.PENDING")).toBe(false)
    expect(isCartCompletingEventType("CHECKOUT.ORDER.APPROVED")).toBe(false)
    expect(isCartCompletingEventType("PAYMENT.REFUND.COMPLETED")).toBe(false)
  })
})

type ContainerOpts = {
  sessionStatus?: string
  /** Sequence of completed_at values returned by successive cart queries. */
  completedAtSequence?: (string | null)[]
}

function makeContainer(opts: ContainerOpts = {}) {
  const updatePaymentSession = vi.fn(async () => {})
  const paymentModule = {
    listPaymentCollections: vi.fn(async () => [{ id: "paycol_1", cart_id: "cart_1" }]),
    listPaymentSessions: vi.fn(async () => [
      {
        id: "ps_1",
        provider_id: "pp_paypal_paypal",
        status: opts.sessionStatus ?? "authorized",
        data: { paypal: { order_id: "ORDER1" } },
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]),
    updatePaymentSession,
  }

  const sequence = opts.completedAtSequence ?? [null]
  let cartQueryCount = 0
  const graph = vi.fn(async (args: { entity: string }) => {
    if (args.entity === "cart") {
      const completedAt =
        sequence[Math.min(cartQueryCount, sequence.length - 1)] ?? null
      cartQueryCount++
      return { data: [{ id: "cart_1", completed_at: completedAt }] }
    }
    return { data: [] }
  })

  const container = {
    resolve: (key: unknown) => {
      if (key === Modules.PAYMENT) return paymentModule
      if (key === "query") return { graph }
      throw new Error(`unexpected container key: ${String(key)}`)
    },
  }

  return { container: container as any, updatePaymentSession, graph }
}

const captureCompletedInput = {
  eventType: "PAYMENT.CAPTURE.COMPLETED",
  payload: {
    resource: {
      id: "CAP1",
      custom_id: "cart_1",
      status: "COMPLETED",
      supplementary_data: { related_ids: { order_id: "ORDER1" } },
    },
  },
}

describe("processPayPalWebhookEvent cart completion", () => {
  beforeEach(() => {
    runCoreWorkflowMock.mockReset()
    delete process.env.PAYPAL_WEBHOOK_COMPLETE_CART
  })

  afterEach(() => {
    delete process.env.PAYPAL_WEBHOOK_COMPLETE_CART
  })

  it("completes an incomplete cart on PAYMENT.CAPTURE.COMPLETED", async () => {
    const { container, updatePaymentSession } = makeContainer()
    runCoreWorkflowMock.mockResolvedValue({ result: { id: "order_1" } })

    const result = await processPayPalWebhookEvent(container, captureCompletedInput)

    expect(updatePaymentSession).toHaveBeenCalledTimes(1)
    expect(runCoreWorkflowMock).toHaveBeenCalledWith(container, "complete-cart", {
      id: "cart_1",
    })
    expect(result.sessionUpdated).toBe(true)
    expect(result.cartCompleted).toBe(true)
  })

  it("does not touch an already-completed cart", async () => {
    const { container } = makeContainer({
      completedAtSequence: ["2026-01-01T00:00:00.000Z"],
    })

    const result = await processPayPalWebhookEvent(container, captureCompletedInput)

    expect(runCoreWorkflowMock).not.toHaveBeenCalled()
    expect(result.cartCompleted).toBe(false)
  })

  it("honors the PAYPAL_WEBHOOK_COMPLETE_CART kill switch", async () => {
    process.env.PAYPAL_WEBHOOK_COMPLETE_CART = "false"
    const { container } = makeContainer()

    const result = await processPayPalWebhookEvent(container, captureCompletedInput)

    expect(runCoreWorkflowMock).not.toHaveBeenCalled()
    expect(result.cartCompleted).toBe(false)
    expect(result.sessionUpdated).toBe(true)
  })

  it("never completes from a non-settlement event", async () => {
    const { container } = makeContainer()

    const result = await processPayPalWebhookEvent(container, {
      eventType: "CHECKOUT.ORDER.APPROVED",
      payload: {
        resource: {
          id: "ORDER1",
          purchase_units: [{ custom_id: "cart_1" }],
        },
      },
    })

    expect(runCoreWorkflowMock).not.toHaveBeenCalled()
    expect(result.cartCompleted).toBe(false)
  })

  it("never completes for a canceled session", async () => {
    const { container, updatePaymentSession } = makeContainer({
      sessionStatus: "canceled",
    })

    const result = await processPayPalWebhookEvent(container, captureCompletedInput)

    // canceled → captured is a disallowed transition AND completion is skipped.
    expect(updatePaymentSession).not.toHaveBeenCalled()
    expect(runCoreWorkflowMock).not.toHaveBeenCalled()
    expect(result.cartCompleted).toBe(false)
  })

  it("treats losing the completion race as success", async () => {
    // First cart read: incomplete → attempt. Workflow throws (storefront won),
    // recheck shows completed → swallowed, no error, not credited to us.
    const { container } = makeContainer({
      completedAtSequence: [null, "2026-01-01T00:00:10.000Z"],
    })
    runCoreWorkflowMock.mockRejectedValue(new Error("Cart already completed"))

    const result = await processPayPalWebhookEvent(container, captureCompletedInput)

    expect(result.cartCompleted).toBe(false)
    expect(result.sessionUpdated).toBe(true)
  })

  it("re-throws a genuine completion failure so the retry schedule keeps it visible", async () => {
    const { container } = makeContainer({ completedAtSequence: [null, null] })
    runCoreWorkflowMock.mockRejectedValue(new Error("inventory reservation failed"))

    await expect(
      processPayPalWebhookEvent(container, captureCompletedInput)
    ).rejects.toThrow(/webhook cart completion failed for cart_1/)
  })
})
