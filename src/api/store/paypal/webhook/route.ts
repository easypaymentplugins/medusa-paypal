import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type PayPalModuleService from "../../../../modules/paypal/service"
import {
  computeNextRetryAt,
  isAllowedEventType,
  isRetryableError,
  normalizeEventVersion,
  processPayPalWebhookEvent,
} from "../../../../modules/paypal/webhook-processor"

const REPLAY_WINDOW_MINUTES = (() => {
  const v = Number(process.env.PAYPAL_WEBHOOK_REPLAY_WINDOW_MINUTES)
  return Number.isFinite(v) && v > 0 ? v : 60
})()

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const direct = headers[name]
  if (Array.isArray(direct)) return direct[0]
  if (typeof direct === "string") return direct
  const lower = name.toLowerCase()
  const key = Object.keys(headers).find((h) => h.toLowerCase() === lower)
  if (!key) return undefined
  const val = headers[key]
  return Array.isArray(val) ? val[0] : val
}

interface ValidationFail {
  ok: false
  status: number
  message: string
}

interface ValidationPass {
  ok: true
  eventId: string
  eventType: string
  transmissionId: string | null
  transmissionTime: Date | null
}

function validateRequest(req: MedusaRequest): ValidationFail | ValidationPass {
  const payload = (req.body || {}) as Record<string, any>
  const eventId = String(payload?.id || payload?.event_id || "").trim()
  const eventType = String(payload?.event_type || payload?.eventType || "").trim()

  if (!eventId || !eventType) {
    return { ok: false, status: 400, message: "Missing required fields: id and event_type" }
  }

  const transmissionTimeHeader = getHeader(req.headers, "paypal-transmission-time")
  if (!transmissionTimeHeader) {
    return {
      ok: false,
      status: 400,
      message: "Missing required header: paypal-transmission-time",
    }
  }

  const transmissionMs = Date.parse(transmissionTimeHeader)
  if (!Number.isFinite(transmissionMs)) {
    return {
      ok: false,
      status: 400,
      message: "Invalid paypal-transmission-time header value",
    }
  }

  const ageMs = Math.abs(Date.now() - transmissionMs)
  if (ageMs > REPLAY_WINDOW_MINUTES * 60 * 1000) {
    return {
      ok: false,
      status: 400,
      message: `Webhook rejected: outside ${REPLAY_WINDOW_MINUTES}-minute replay window`,
    }
  }

  return {
    ok: true,
    eventId,
    eventType,
    transmissionId: getHeader(req.headers, "paypal-transmission-id") || null,
    transmissionTime: new Date(transmissionMs),
  }
}

function resolveWebhookId(
  environment: string,
  settings: Record<string, unknown>
): string | undefined {
  const ids = (settings?.webhook_ids || {}) as Record<string, string | undefined>
  if (environment === "live") {
    return (
      ids.live ||
      (settings?.webhook_id_live as string) ||
      process.env.PAYPAL_WEBHOOK_ID_LIVE
    )
  }
  return (
    ids.sandbox ||
    (settings?.webhook_id_sandbox as string) ||
    process.env.PAYPAL_WEBHOOK_ID_SANDBOX
  )
}

async function verifyWebhookSignature(
  paypal: PayPalModuleService,
  environment: string,
  body: Record<string, unknown>,
  headers: Record<string, string | string[] | undefined>
): Promise<void> {
  const settings = await paypal.getSettings().catch(() => ({ data: {} }))
  const webhookId = resolveWebhookId(
    environment,
    (settings?.data as Record<string, unknown>) || {}
  )

  if (!webhookId) {
    throw new Error(
      `PayPal webhook ID not configured for environment "${environment}". Set PAYPAL_WEBHOOK_ID_${environment.toUpperCase()} or configure it in admin settings.`
    )
  }

  const base =
    environment === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com"

  const accessToken = await paypal.getAppAccessToken()

  const verifyPayload = {
    auth_algo: getHeader(headers, "paypal-auth-algo"),
    cert_url: getHeader(headers, "paypal-cert-url"),
    transmission_id: getHeader(headers, "paypal-transmission-id"),
    transmission_sig: getHeader(headers, "paypal-transmission-sig"),
    transmission_time: getHeader(headers, "paypal-transmission-time"),
    webhook_id: webhookId,
    webhook_event: body,
  }

  const missing = Object.entries(verifyPayload)
    .filter(([k, v]) => k !== "webhook_id" && k !== "webhook_event" && !v)
    .map(([k]) => k)

  if (missing.length > 0) {
    throw new Error(`Missing required PayPal webhook headers: ${missing.join(", ")}`)
  }

  const resp = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(verifyPayload),
  })

  const json = await resp.json().catch(() => ({}))
  const debugId = resp.headers.get("paypal-debug-id") || json?.debug_id

  if (!resp.ok) {
    throw new Error(
      `PayPal signature verification API error (${resp.status}): ${JSON.stringify(json)}` +
        (debugId ? ` debug_id=${debugId}` : "")
    )
  }
  if (json?.verification_status !== "VERIFIED") {
    throw new Error(
      `PayPal webhook signature not verified. Status: ${json?.verification_status}` +
        (debugId ? ` debug_id=${debugId}` : "")
    )
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const paypal = req.scope.resolve<PayPalModuleService>("paypal_onboarding")

  const validation = validateRequest(req)
  if (!validation.ok) {
    console.warn("[PayPal] webhook: validation failed:", validation.message)
    return res.status(validation.status).json({ message: validation.message })
  }

  const { eventId, eventType, transmissionId, transmissionTime } = validation
  const payload = (req.body || {}) as Record<string, any>

  if (transmissionId) {
    try {
      const existing = await paypal.listPayPalWebhookEvents({ transmission_id: transmissionId })
      if ((existing || []).length > 0) {
        console.info("[PayPal] webhook: duplicate transmission_id", {
          transmissionId,
          eventId,
        })
        return res.json({ ok: true, duplicate: true })
      }
    } catch (e: any) {
      console.warn("[PayPal] webhook: transmission_id dedup check failed:", e?.message)
    }
  }

  try {
    const creds = await paypal.getActiveCredentials()
    await verifyWebhookSignature(paypal, creds.environment, payload, req.headers)
  } catch (e: any) {
    console.error("[PayPal] webhook: signature verification failed:", e?.message)
    return res
      .status(401)
      .json({ message: e?.message || "Webhook signature verification failed" })
  }

  const eventVersion = normalizeEventVersion(payload)
  let recordId: string | null = null

  try {
    const recordResult = await paypal.createWebhookEventRecord({
      event_id: eventId,
      event_type: eventType,
      payload,
      event_version: eventVersion,
      transmission_id: transmissionId,
      transmission_time: transmissionTime,
      status: "processing",
      attempt_count: 1,
    })

    if (!recordResult.created) {
      console.info("[PayPal] webhook: duplicate event_id", { eventId, eventType })
      return res.json({ ok: true, duplicate: true })
    }

    recordId = recordResult.event?.id ?? null
  } catch (e: any) {
    console.error("[PayPal] webhook: failed to create DB record:", e?.message)
    return res.status(500).json({ message: "Failed to record webhook event" })
  }

  if (!isAllowedEventType(eventType)) {
    console.info("[PayPal] webhook: unsupported event type, ignoring", { eventType })
    await paypal.recordAuditEvent("webhook_unsupported_event", {
      event_id: eventId,
      event_type: eventType,
    })
    if (recordId) {
      await paypal
        .updateWebhookEventRecord({
          id: recordId,
          status: "ignored",
          processed_at: new Date(),
        })
        .catch(() => {})
    }
    return res.json({ ok: true, ignored: true })
  }

  try {
    const processed = await processPayPalWebhookEvent(req.scope, { eventType, payload })

    if (recordId) {
      await paypal
        .updateWebhookEventRecord({
          id: recordId,
          status: "processed",
          processed_at: new Date(),
          resource_id:
            processed.refundId || processed.captureId || processed.orderId || null,
        })
        .catch(() => {})
    }

    console.info("[PayPal] webhook: processed", {
      event_id: eventId,
      event_type: eventType,
      order_id: processed.orderId,
      capture_id: processed.captureId,
      refund_id: processed.refundId,
      cart_id: processed.cartId,
      session_updated: processed.sessionUpdated,
    })

    await paypal.recordMetric("webhook_success").catch(() => {})
    return res.json({ ok: true })
  } catch (e: any) {
    console.error("[PayPal] webhook: processing failed", {
      event_id: eventId,
      event_type: eventType,
      error: e?.message,
    })

    const retryable = isRetryableError(e)
    const nextStatus = retryable ? "failed" : "dead_letter"

    if (recordId) {
      await paypal
        .updateWebhookEventRecord({
          id: recordId,
          status: nextStatus,
          attempt_count: 1,
          next_retry_at: retryable ? computeNextRetryAt(1) : null,
          last_error: e?.message || String(e),
        })
        .catch(() => {})
    }

    await paypal
      .recordAuditEvent("webhook_processing_failed", {
        event_id: eventId,
        event_type: eventType,
        retryable,
        message: e?.message || String(e),
      })
      .catch(() => {})

    await paypal.recordMetric("webhook_failed").catch(() => {})

    if (!retryable) {
      return res.status(200).json({ ok: false, message: e?.message })
    }
    return res
      .status(500)
      .json({ message: e?.message || "PayPal webhook processing error" })
  }
}
