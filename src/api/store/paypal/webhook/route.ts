import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import type { IEventBusModuleService } from "@medusajs/framework/types"
import type PayPalModuleService from "../../../../modules/paypal/service"
import { paypalFetch } from "../../../../modules/paypal/utils/paypal-fetch"
import {
  isAllowedEventType,
  normalizeEventVersion,
} from "../../../../modules/paypal/webhook-processor"
import { PAYPAL_WEBHOOK_RECEIVED_EVENT } from "../../../../subscribers/paypal-webhook-process"
import {
  composeVerifyRequestBody,
  rawBodyToString,
  resolveWebhookEventJson,
} from "../../../../modules/paypal/utils/webhook-verify"

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
  headers: Record<string, string | string[] | undefined>,
  rawBody: string | null
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

  const verifyFields = {
    auth_algo: getHeader(headers, "paypal-auth-algo"),
    cert_url: getHeader(headers, "paypal-cert-url"),
    transmission_id: getHeader(headers, "paypal-transmission-id"),
    transmission_sig: getHeader(headers, "paypal-transmission-sig"),
    transmission_time: getHeader(headers, "paypal-transmission-time"),
    webhook_id: webhookId,
  }

  const certUrl = verifyFields.cert_url
  if (
    certUrl &&
    !certUrl.startsWith("https://www.paypal.com/") &&
    !certUrl.startsWith("https://api-m.paypal.com/") &&
    !certUrl.startsWith("https://api-m.sandbox.paypal.com/")
  ) {
    throw new Error("Invalid paypal-cert-url: must originate from paypal.com")
  }

  const missing = Object.entries(verifyFields)
    .filter(([k, v]) => k !== "webhook_id" && !v)
    .map(([k]) => k)

  if (missing.length > 0) {
    throw new Error(`Missing required PayPal webhook headers: ${missing.join(", ")}`)
  }

  // Use the raw bytes PayPal signed for `webhook_event` whenever available
  // (preserved by the route's `bodyParser: { preserveRawBody: true }`); fall
  // back to serializing the parsed body so verification still runs if it isn't.
  const requestBody = composeVerifyRequestBody(
    verifyFields,
    resolveWebhookEventJson(rawBody, body)
  )

  const resp = await paypalFetch(`${base}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: requestBody,
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
      const existing = await paypal.listPayPalWebhookEvents({ transmission_id: transmissionId }, { take: 1 })
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
    const rawBody = rawBodyToString((req as unknown as { rawBody?: unknown }).rawBody)
    await verifyWebhookSignature(paypal, creds.environment, payload, req.headers, rawBody)
  } catch (e: any) {
    console.error("[PayPal] webhook: signature verification failed:", e?.message)
    return res
      .status(401)
      .json({ message: "Webhook signature verification failed" })
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

  // Process the verified, persisted event asynchronously: emit an event and
  // return 200 immediately so PayPal's ~15s webhook delivery timeout is never
  // tripped by slow downstream work (the audit's synchronous-processing
  // bottleneck). The `paypal-webhook-process` subscriber does the actual work
  // off the request path; if the event bus drops the message, the webhook retry
  // cron recovers events left in "processing" past a staleness threshold, so the
  // event is never lost. The record is already persisted as "processing" above.
  try {
    const eventBus = req.scope.resolve<IEventBusModuleService>(Modules.EVENT_BUS)
    await eventBus.emit({
      name: PAYPAL_WEBHOOK_RECEIVED_EVENT,
      data: { id: recordId },
    })
    console.info("[PayPal] webhook: accepted for async processing", {
      event_id: eventId,
      event_type: eventType,
      record_id: recordId,
    })
  } catch (e: any) {
    // The event was persisted as "processing"; the retry cron's stale-processing
    // recovery will pick it up even though the emit failed. Ack PayPal anyway so
    // it doesn't re-deliver (which would just dedupe).
    console.error("[PayPal] webhook: failed to enqueue async processing (retry cron will recover)", {
      event_id: eventId,
      event_type: eventType,
      record_id: recordId,
      error: e?.message,
    })
  }

  return res.json({ ok: true, accepted: true })
}
