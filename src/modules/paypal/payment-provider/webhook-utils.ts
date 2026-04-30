import type {
  ProviderWebhookPayload,
  WebhookActionResult,
} from "@medusajs/framework/types"

const EVENT_ACTIONS: Record<string, WebhookActionResult["action"]> = {
  "CHECKOUT.ORDER.CREATED": "pending",
  "CHECKOUT.ORDER.SAVED": "pending",
  "CHECKOUT.ORDER.APPROVED": "authorized",
  "CHECKOUT.ORDER.PAYER_ACTION_REQUIRED": "pending",
  "CHECKOUT.ORDER.CANCELLED": "canceled",
  "CHECKOUT.ORDER.EXPIRED": "failed",
  "CHECKOUT.ORDER.VOIDED": "canceled",
  "CHECKOUT.ORDER.COMPLETED": "captured",
  "PAYMENT.AUTHORIZATION.CREATED": "authorized",
  "PAYMENT.AUTHORIZATION.DENIED": "failed",
  "PAYMENT.AUTHORIZATION.EXPIRED": "failed",
  "PAYMENT.AUTHORIZATION.PENDING": "pending",
  "PAYMENT.AUTHORIZATION.VOIDED": "canceled",
  "PAYMENT.CAPTURE.COMPLETED": "captured",
  "PAYMENT.CAPTURE.DENIED": "failed",
  "PAYMENT.CAPTURE.PENDING": "pending",
  "PAYMENT.CAPTURE.REFUNDED": "canceled",
  "PAYMENT.CAPTURE.REVERSED": "canceled",
  "PAYMENT.REFUND.COMPLETED": "canceled",
  "PAYMENT.REFUND.DENIED": "failed",
}

function resolveSessionId(resource: any): string | undefined {
  return (
    resource?.custom_id ||
    resource?.purchase_units?.[0]?.custom_id ||
    resource?.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id ||
    resource?.purchase_units?.[0]?.payments?.authorizations?.[0]?.custom_id ||
    resource?.purchase_units?.[0]?.payments?.refunds?.[0]?.custom_id
  )
}

function resolveAmount(resource: any): number | undefined {
  const amount =
    resource?.amount ||
    resource?.purchase_units?.[0]?.amount ||
    resource?.purchase_units?.[0]?.payments?.captures?.[0]?.amount ||
    resource?.purchase_units?.[0]?.payments?.authorizations?.[0]?.amount ||
    resource?.purchase_units?.[0]?.payments?.refunds?.[0]?.amount ||
    resource?.seller_receivable_breakdown?.gross_amount
  const value = amount?.value ?? amount?.amount?.value
  if (value === undefined || value === null) {
    return undefined
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function resolveEventType(payload: ProviderWebhookPayload["payload"]) {
  const raw = payload as { event_type?: string; eventType?: string }
  return raw?.event_type || raw?.eventType
}

export function getPayPalWebhookActionAndData(
  payload: ProviderWebhookPayload["payload"]
): WebhookActionResult {
  const eventType = resolveEventType(payload)
  if (!eventType) {
    return { action: "not_supported" }
  }

  const action = EVENT_ACTIONS[eventType]
  if (!action) {
    return { action: "not_supported" }
  }

  const resource = (payload as { resource?: unknown })?.resource
  const sessionId = resolveSessionId(resource)
  const amount = resolveAmount(resource)

  if (!sessionId || amount === undefined) {
    return { action: "not_supported" }
  }

  return {
    action,
    data: {
      session_id: sessionId,
      amount,
    },
  }
}
