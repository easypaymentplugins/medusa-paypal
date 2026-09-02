import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { randomUUID } from "crypto"
import type PayPalModuleService from "../../../../modules/paypal/service"
import { getPayPalApiBase } from "../../../../modules/paypal/utils/paypal-auth"
import { PAYPAL_PARTNER_ATTRIBUTION_ID as BN_CODE } from "../../../../modules/paypal/utils/partner"
import { paypalFetch } from "../../../../modules/paypal/utils/paypal-fetch"
import { extractCaptureStatus } from "../../../../modules/paypal/payment-provider/status-utils"
import {
  findPayPalSessionForCart,
  getStoredPayPalOrderId,
  updatePayPalSessionData,
} from "../../../../modules/paypal/utils/payment-session"

const PAYPAL_ORDER_ID_RE = /^[A-Z0-9]{10,25}$/

type Body = {
  cart_id: string
  order_id: string
}

function resolveIdempotencyKey(req: MedusaRequest, suffix: string, fallback: string) {
  const header =
    req.headers["idempotency-key"] ||
    req.headers["Idempotency-Key"] ||
    req.headers["x-idempotency-key"] ||
    req.headers["X-Idempotency-Key"]
  const key = Array.isArray(header) ? header[0] : header
  if (key && String(key).trim()) {
    return `${String(key).trim()}-${suffix}`
  }
  return fallback || `pp-${suffix}-${randomUUID()}`
}

/**
 * Persist the capture onto the cart's PayPal session. Returns `true` when the
 * data was written (or there was nothing to write because no session exists),
 * and `false` when the write ultimately failed after retries. The caller must
 * NOT silently treat a `false` here as success: the funds were captured at
 * PayPal, so a persistence failure has to be recorded/alerted (the webhook and
 * paypal-complete's live re-derivation are the reconciliation backstop).
 */
async function attachPayPalCaptureToSession(
  cartId: string,
  orderId: string,
  capture: any,
  scope: any
): Promise<boolean> {
  const session = await findPayPalSessionForCart(cartId, scope)
  if (!session) {
    console.warn("[PayPal] attachPayPalCaptureToSession: no session found for cart", cartId)
    return true
  }

  const captureId = capture?.purchase_units?.[0]?.payments?.captures?.[0]?.id || capture?.id

  try {
    await updatePayPalSessionData(
      session.session_id,
      {
        paypal: {
          ...((session.session_data || {}).paypal || {}),
          order_id: orderId,
          capture_id: captureId,
          capture,
        },
      },
      scope
    )
    return true
  } catch (e: unknown) {
    console.error(
      "[PayPal] attachPayPalCaptureToSession failed:",
      e instanceof Error ? e.message : e
    )
    return false
  }
}

async function attachPayPalAuthorizationToSession(
  cartId: string,
  orderId: string,
  authorization: any,
  scope: any
): Promise<boolean> {
  const session = await findPayPalSessionForCart(cartId, scope)
  if (!session) {
    console.warn("[PayPal] attachPayPalAuthorizationToSession: no session found for cart", cartId)
    return true
  }

  const authorizationId = authorization?.purchase_units?.[0]?.payments?.authorizations?.[0]?.id

  try {
    await updatePayPalSessionData(
      session.session_id,
      {
        paypal: {
          ...((session.session_data || {}).paypal || {}),
          order_id: orderId,
          authorization_id: authorizationId,
          authorization,
        },
      },
      scope
    )
    return true
  } catch (e: unknown) {
    console.error(
      "[PayPal] attachPayPalAuthorizationToSession failed:",
      e instanceof Error ? e.message : e
    )
    return false
  }
}

/**
 * Return the session's existing capture ONLY when it demonstrably COMPLETED.
 *
 * The session can carry a capture that never settled: the webhook processor
 * patches `capture_id` onto the session for every capture event, including
 * PAYMENT.CAPTURE.DENIED and PENDING. Blindly short-circuiting on any stored
 * capture would report success to the storefront for a payment that was
 * declined — the buyer would then hit "payment processed but order could not
 * be finalized" instead of being able to retry.
 *
 * - stored capture object with a known status: COMPLETED → return it,
 *   anything else → null (fall through and attempt a real capture).
 * - bare `capture_id` (or a capture object whose status can't be read):
 *   verify against the live PayPal order. If PayPal can't be reached, return
 *   the stored data — the previous fail-safe behavior — since attempting a
 *   fresh capture against an unreachable PayPal would fail anyway.
 */
async function getExistingCompletedCapture(
  cartId: string,
  orderId: string,
  scope: any,
  fetchLiveOrder: () => Promise<any>
) {
  try {
    const session = await findPayPalSessionForCart(cartId, scope)
    if (!session) return null

    const paypalData = (session.session_data || {}).paypal || {}
    const existingOrderId = String(paypalData.order_id || "")
    if (existingOrderId && existingOrderId !== orderId) return null

    const stored = paypalData.capture
    if (stored) {
      const storedStatus = extractCaptureStatus(stored)
      if (storedStatus === "COMPLETED") return stored
      if (storedStatus) return null
      // no readable status on the stored object — verify live below
    }
    if (!stored && !paypalData.capture_id) return null

    let order: any
    try {
      order = await fetchLiveOrder()
    } catch {
      return stored || { id: paypalData.capture_id }
    }
    const liveCapture = order?.purchase_units?.[0]?.payments?.captures?.[0]
    if (liveCapture && extractCaptureStatus(liveCapture) === "COMPLETED") {
      return liveCapture
    }
    return null
  } catch {
    return null
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const paypal = req.scope.resolve<PayPalModuleService>("paypal_onboarding")
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER)
  const requestId = randomUUID()
  const { scope } = req
  let debugId: string | null = null

  try {
    const body = (req.body || {}) as Body
    const cartId = body.cart_id
    const orderId = body.order_id

    if (!cartId || !orderId) {
      return res.status(400).json({ message: "cart_id and order_id are required" })
    }

    if (typeof cartId !== "string" || !cartId.startsWith("cart_")) {
      return res.status(400).json({ message: "Invalid cart_id format" })
    }

    if (!PAYPAL_ORDER_ID_RE.test(orderId)) {
      return res.status(400).json({ message: "Invalid order_id format" })
    }

    // Bind the capture to the cart's own PayPal session, fail-closed: the
    // order_id MUST be the one this cart's session created (stored by
    // create-order). This prevents capturing an arbitrary, caller-supplied
    // order_id against the merchant account.
    const session = await findPayPalSessionForCart(cartId, scope)
    const sessionOrderId = getStoredPayPalOrderId(session?.session_data)
    if (!session || !sessionOrderId) {
      return res.status(409).json({
        message: "No PayPal order is associated with this cart's payment session",
      })
    }
    if (sessionOrderId !== orderId) {
      return res.status(400).json({
        message: "order_id does not match the payment session for this cart",
      })
    }

    const creds = await paypal.getActiveCredentials()
    // Cached app access token (single-flight refresh) — avoids an OAuth
    // round-trip on every capture-order call.
    const base = getPayPalApiBase(creds.environment)
    const accessToken = await paypal.getAppAccessToken()

    const fetchLiveOrder = async () => {
      const resp = await paypalFetch(
        `${base}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      )
      if (!resp.ok) {
        throw new Error(`PayPal get order error (${resp.status})`)
      }
      return resp.json()
    }

    const existingCapture = await getExistingCompletedCapture(
      cartId,
      orderId,
      scope,
      fetchLiveOrder
    )
    if (existingCapture) {
      return res.json({ capture: existingCapture })
    }

    const settings = await paypal.getSettings().catch(() => ({}))
    const data =
      settings && typeof settings === "object" && "data" in settings
        ? ((settings as { data?: Record<string, any> }).data ?? {})
        : {}
    const additionalSettings = (data.additional_settings || {}) as Record<string, any>
    const paymentAction =
      typeof additionalSettings.paymentAction === "string"
        ? additionalSettings.paymentAction
        : "capture"

    // The suffix must include the order id: PayPal deduplicates by
    // PayPal-Request-Id, so a client reusing one Idempotency-Key header across
    // two different orders would otherwise get order A's cached capture back
    // for order B. Named `paypalRequestId` so it never shadows `requestId`
    // (the log/response correlation UUID declared at the top of POST).
    const paypalRequestId = resolveIdempotencyKey(
      req,
      `capture-order-${orderId}`,
      `pp-capture-${orderId}`
    )
    const safeOrderId = encodeURIComponent(orderId)
    const endpoint =
      paymentAction === "authorize"
        ? `${base}/v2/checkout/orders/${safeOrderId}/authorize`
        : `${base}/v2/checkout/orders/${safeOrderId}/capture`

    const ppResp = await paypalFetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": paypalRequestId,
        "PayPal-Partner-Attribution-Id": BN_CODE,
      },
    })

    const ppText = await ppResp.text()
    debugId = ppResp.headers.get("paypal-debug-id")
    if (!ppResp.ok) {
      throw new Error(
        `PayPal capture error (${ppResp.status}): ${ppText}${debugId ? ` debug_id=${debugId}` : ""}`
      )
    }

    const payload = JSON.parse(ppText)
    let persisted = true
    if (paymentAction === "authorize") {
      persisted = await attachPayPalAuthorizationToSession(cartId, orderId, payload, req.scope)
    } else {
      // A 2xx capture response does NOT guarantee the funds settled: PayPal
      // returns 201 for PENDING (pending review / eCheck), DECLINED and FAILED
      // captures too. Returning those to the storefront as a successful capture
      // would let it finalize the cart for a payment that never completed, so
      // only a COMPLETED capture is reported as success — the webhook will
      // reconcile a later PENDING→COMPLETED transition.
      const captureStatus = extractCaptureStatus(payload)
      if (captureStatus !== "COMPLETED") {
        throw new Error(
          `PayPal capture did not complete (status=${captureStatus || "UNKNOWN"})${
            debugId ? ` debug_id=${debugId}` : ""
          }`
        )
      }
      persisted = await attachPayPalCaptureToSession(cartId, orderId, payload, req.scope)
    }

    // The PayPal operation itself succeeded. If we could not persist it onto the
    // Medusa session, the money is (authorized/)captured but Medusa doesn't yet
    // record it — record a metric and log CRITICAL so it's observable/alertable.
    // We still return success to the storefront: re-capturing would hit
    // ORDER_ALREADY_CAPTURED, and both the webhook and paypal-complete's live
    // PayPal re-derivation reconcile the session afterward.
    if (!persisted) {
      logger.error(
        `[paypal] CRITICAL: ${
          paymentAction === "authorize" ? "authorization" : "capture"
        } succeeded at PayPal but could not be persisted to the session (request_id=${requestId}, cart_id=${cartId}, order_id=${orderId})`
      )
      try {
        await paypal.recordMetric(
          paymentAction === "authorize"
            ? "authorize_order_persist_failed"
            : "capture_order_persist_failed"
        )
      } catch {
      }
    }

    try {
      await paypal.recordMetric(
        paymentAction === "authorize" ? "authorize_order_success" : "capture_order_success"
      )
    } catch {
    }

    return paymentAction === "authorize"
      ? res.json({ authorization: payload })
      : res.json({ capture: payload })
  } catch (e: any) {
    const body = (req.body || {}) as Body
    logger.error(
      `[paypal] capture-order failed (request_id=${requestId}, cart_id=${
        body.cart_id ?? "n/a"
      }, order_id=${body.order_id ?? "n/a"}, debug_id=${debugId ?? "n/a"}): ${
        e?.message ?? String(e)
      }`,
      e instanceof Error ? e : undefined
    )
    try {
      await paypal.recordAuditEvent("capture_order_failed", {
        cart_id: body.cart_id,
        order_id: body.order_id,
        debug_id: debugId,
        request_id: requestId,
        message: e?.message || String(e),
      })
      await paypal.recordMetric("capture_order_failed")
    } catch {
    }
    return res.status(500).json({ message: "Failed to capture PayPal order", request_id: requestId })
  }
}
