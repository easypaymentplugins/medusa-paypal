import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { isPayPalProviderId } from "./utils/provider-ids"


export const EVENT_STATUS_MAP: Record<
  string,
  "authorized" | "captured" | "canceled" | "error"
> = {
  "CHECKOUT.ORDER.APPROVED": "authorized",
  "CHECKOUT.ORDER.CANCELLED": "canceled",
  "PAYMENT.CAPTURE.COMPLETED": "captured",
  "PAYMENT.CAPTURE.DENIED": "error",
  "PAYMENT.CAPTURE.PENDING": "authorized",
  "PAYMENT.CAPTURE.REFUNDED": "canceled",
  "PAYMENT.CAPTURE.REVERSED": "canceled",
  "PAYMENT.AUTHORIZATION.CREATED": "authorized",
  "PAYMENT.AUTHORIZATION.VOIDED": "canceled",
  "PAYMENT.AUTHORIZATION.DENIED": "error",
  "PAYMENT.AUTHORIZATION.EXPIRED": "canceled",
  "PAYMENT.REFUND.COMPLETED": "canceled",
  "PAYMENT.REFUND.DENIED": "error",
}


const ALLOWED_TRANSITIONS: Record<string, Set<string>> = {
  pending: new Set(["authorized", "captured", "canceled", "error"]),
  authorized: new Set(["captured", "canceled", "error"]),
  captured: new Set(["canceled"]),
  canceled: new Set([]),
  error: new Set(["authorized", "captured", "canceled"]),
}

export function isTransitionAllowed(from: string, to: string): boolean {
  return ALLOWED_TRANSITIONS[from]?.has(to) ?? false
}


export const SUPPORTED_EVENT_PREFIXES = [
  "PAYMENT.CAPTURE.",
  "CHECKOUT.ORDER.",
  "PAYMENT.AUTHORIZATION.",
  "PAYMENT.REFUND.",
]

export function isAllowedEventType(eventType: string): boolean {
  return SUPPORTED_EVENT_PREFIXES.some((prefix) => eventType.startsWith(prefix))
}


const NON_RETRYABLE_PATTERNS = [
  "payment collection not found",
  "no paypal session",
  "session not found",
  "cart not found",
  "no payment collection",
]

export function isRetryableError(error: unknown): boolean {
  const message = String(
    error instanceof Error ? error.message : error ?? ""
  ).toLowerCase()
  return !NON_RETRYABLE_PATTERNS.some((p) => message.includes(p))
}


const RETRY_SCHEDULE_MINUTES = [2, 10, 30, 60, 120]
export const MAX_WEBHOOK_ATTEMPTS = RETRY_SCHEDULE_MINUTES.length + 1

export function computeNextRetryAt(attemptCount: number): Date | null {
  const idx = attemptCount - 1
  const delayMinutes = RETRY_SCHEDULE_MINUTES[idx]
  if (delayMinutes === undefined || attemptCount <= 0) return null
  return new Date(Date.now() + delayMinutes * 60 * 1000)
}


export function normalizeResource(payload: Record<string, any>): Record<string, any> {
  const resource = payload?.resource
  if (!resource) return {}
  if (typeof resource === "string") {
    try {
      return JSON.parse(resource)
    } catch {
      return {}
    }
  }
  return resource as Record<string, any>
}

export function normalizeEventVersion(payload: Record<string, any>): string | null {
  const raw =
    payload?.event_version ??
    payload?.resource_version ??
    payload?.resource?.resource_version ??
    payload?.resource?.version ??
    null
  if (!raw) return null
  return String(raw).trim().replace(/^v/i, "")
}


export interface ExtractedIdentifiers {
  orderId: string | null
  captureId: string | null
  refundId: string | null
  cartId: string | null
}

export function extractIdentifiers(
  resource: Record<string, any>,
  eventType: string
): ExtractedIdentifiers {
  const related = resource?.supplementary_data?.related_ids || {}
  const isOrder = eventType.startsWith("CHECKOUT.ORDER.")
  const isCapture = eventType.startsWith("PAYMENT.CAPTURE.")
  const isAuthorization = eventType.startsWith("PAYMENT.AUTHORIZATION.")
  const isRefund = eventType.startsWith("PAYMENT.REFUND.")

  let orderId: string | null = null
  let captureId: string | null = null
  let refundId: string | null = null
  let cartId: string | null = null

  if (isOrder) {
    orderId = String(resource?.id || "").trim() || null
    cartId =
      String(
        resource?.purchase_units?.[0]?.custom_id || resource?.custom_id || ""
      ).trim() || null
    captureId =
      String(
        resource?.purchase_units?.[0]?.payments?.captures?.[0]?.id || ""
      ).trim() || null
  } else if (isCapture) {
    captureId = String(resource?.id || "").trim() || null
    orderId = String(related?.order_id || "").trim() || null
    cartId = String(resource?.custom_id || "").trim() || null
  } else if (isAuthorization) {
    orderId = String(related?.order_id || "").trim() || null
    cartId = String(resource?.custom_id || "").trim() || null
  } else if (isRefund) {
    refundId = String(resource?.id || "").trim() || null
    orderId = String(related?.order_id || "").trim() || null
    captureId = String(related?.capture_id || "").trim() || null
    cartId = null
  }

  return { orderId, captureId, refundId, cartId }
}


interface ResolvedSession {
  sessionId: string
  sessionData: Record<string, any>
  sessionStatus: string
  collectionId: string
}

async function findPayPalSession(
  container: MedusaContainer,
  cartId: string
): Promise<ResolvedSession | null> {
  const paymentModule = container.resolve(Modules.PAYMENT) as any

  let collections: any[]
  try {
    collections = await paymentModule.listPaymentCollections(
      { cart_id: [cartId] },
      { take: 1 }
    )
  } catch (e: any) {
    throw new Error(`payment collection not found for cart ${cartId}: ${e?.message}`)
  }

  const collection = collections?.[0]
  if (!collection?.id) {
    throw new Error(`payment collection not found for cart ${cartId}`)
  }

  const sessions = await paymentModule.listPaymentSessions({
    payment_collection_id: collection.id,
  })

  const paypalSession = (sessions || [])
    .filter((s: any) => isPayPalProviderId(s.provider_id))
    .sort(
      (a: any, b: any) =>
        new Date(b.created_at || 0).getTime() -
        new Date(a.created_at || 0).getTime()
    )[0]

  if (!paypalSession) {
    throw new Error(
      `no paypal session found in collection ${collection.id} for cart ${cartId}`
    )
  }

  return {
    sessionId: paypalSession.id,
    sessionData: (paypalSession.data || {}) as Record<string, any>,
    sessionStatus: String(paypalSession.status || "pending"),
    collectionId: collection.id,
  }
}


function mergeRefunds(existing: any[], incoming: any[]): any[] {
  const seen = new Set<string>()
  const merged: any[] = []
  for (const refund of [...existing, ...incoming]) {
    const id = String(refund?.id || "")
    if (id && seen.has(id)) continue
    if (id) seen.add(id)
    merged.push(refund)
  }
  return merged
}

async function applyStatusToSession(
  container: MedusaContainer,
  resolved: ResolvedSession,
  status: string,
  patch: Record<string, unknown>
): Promise<void> {
  const paymentModule = container.resolve(Modules.PAYMENT) as any

  if (!isTransitionAllowed(resolved.sessionStatus, status)) {
    console.info(
      `[PayPal] webhook: skipping disallowed transition ${resolved.sessionStatus} → ${status} for session ${resolved.sessionId}`
    )
    return
  }

  const existingPaypal = (resolved.sessionData.paypal || {}) as Record<string, any>
  const existingRefunds = Array.isArray(existingPaypal.refunds)
    ? existingPaypal.refunds
    : []
  const incomingRefunds = Array.isArray(patch.refunds)
    ? (patch.refunds as any[])
    : null
  const nextRefunds = incomingRefunds
    ? mergeRefunds(existingRefunds, incomingRefunds)
    : existingRefunds

  await paymentModule.updatePaymentSession({
    id: resolved.sessionId,
    status,
    data: {
      ...resolved.sessionData,
      paypal: {
        ...existingPaypal,
        ...patch,
        refunds: nextRefunds,
      },
    },
  })
}


export interface ProcessResult {
  orderId: string | null
  captureId: string | null
  refundId: string | null
  cartId: string | null
  sessionUpdated: boolean
}

export async function processPayPalWebhookEvent(
  container: MedusaContainer,
  input: {
    eventType: string
    payload: Record<string, any>
  }
): Promise<ProcessResult> {
  const resource = normalizeResource(input.payload)
  const { orderId, captureId, refundId, cartId: rawCartId } = extractIdentifiers(
    resource,
    input.eventType
  )

  const refundReason =
    String(
      resource?.note_to_payer || resource?.reason || resource?.seller_note || ""
    ).trim() || undefined
  const refundReasonCode =
    String(resource?.reason_code || resource?.reasonCode || "").trim() ||
    undefined

  const targetStatus = EVENT_STATUS_MAP[input.eventType]
  if (!targetStatus) {
    return { orderId, captureId, refundId, cartId: rawCartId, sessionUpdated: false }
  }

  let cartId = rawCartId

  if (!cartId) {
    try {
      const paymentModule = container.resolve(Modules.PAYMENT) as any
      const allSessions = await paymentModule.listPaymentSessions({
        provider_id: ["pp_paypal_paypal", "pp_paypal_card_paypal_card"],
      })
      const matchedSession = (allSessions || []).find((s: any) => {
        const pp = ((s.data || {}) as Record<string, any>).paypal || {}
        if (orderId && pp.order_id === orderId) return true
        if (captureId && pp.capture_id === captureId) return true
        return false
      })
      if (matchedSession?.payment_collection_id) {
        const colls = await paymentModule.listPaymentCollections(
          { id: [matchedSession.payment_collection_id] },
          { take: 1 }
        )
        cartId = String(colls?.[0]?.cart_id || "").trim() || null
      }
    } catch (e: any) {
      console.warn(
        `[PayPal] webhook: cartId fallback lookup failed for ${input.eventType}:`,
        e?.message
      )
    }
  }

  let sessionUpdated = false

  if (cartId) {
    const resolved = await findPayPalSession(container, cartId)
    if (resolved) {
      const refundEntry = refundId
        ? [
            {
              id: refundId,
              status: resource?.status,
              reason: refundReason,
              reason_code: refundReasonCode,
              amount: resource?.amount,
              raw: resource,
            },
          ]
        : null

      await applyStatusToSession(container, resolved, targetStatus, {
        order_id: orderId,
        capture_id: captureId ?? resolved.sessionData.paypal?.capture_id ?? undefined,
        refund_id: refundId,
        refund_status: refundId ? resource?.status : undefined,
        refund_reason: refundReason,
        refund_reason_code: refundReasonCode,
        ...(refundEntry ? { refunds: refundEntry } : {}),
        webhook_event_type: input.eventType,
        last_webhook_at: new Date().toISOString(),
      })
      sessionUpdated = true
    }
  } else {
    console.warn(
      `[PayPal] webhook: could not resolve cartId for event ${input.eventType}`,
      { orderId, captureId, refundId }
    )
  }

  return { orderId, captureId, refundId, cartId, sessionUpdated }
}
