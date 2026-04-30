import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { IPaymentModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { randomUUID } from "crypto"
import type PayPalModuleService from "../../../../modules/paypal/service"
import { getPayPalAccessToken } from "../../../../modules/paypal/utils/paypal-auth"
import { isPayPalProviderId } from "../../../../modules/paypal/utils/provider-ids"

const BN_CODE = "MBJTechnolabs_SI_SPB"

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

async function findPayPalSessionForCart(
  cartId: string,
  scope: any
): Promise<{
  session_id: string
  session_data: Record<string, any>
  session_status: string
} | null> {
  try {
    const query = scope.resolve("query")
    const { data: carts } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "payment_collection.payment_sessions.id",
        "payment_collection.payment_sessions.data",
        "payment_collection.payment_sessions.status",
        "payment_collection.payment_sessions.provider_id",
        "payment_collection.payment_sessions.created_at",
      ],
      filters: { id: cartId },
    })
    const cart = carts?.[0]
    const sessions = cart?.payment_collection?.payment_sessions || []
    const session = sessions
      .filter((s: any) => isPayPalProviderId(s.provider_id))
      .sort(
        (a: any, b: any) =>
          new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      )[0]

    if (!session) return null

    return {
      session_id: session.id,
      session_data: (session.data || {}) as Record<string, any>,
      session_status: session.status,
    }
  } catch (e: any) {
    console.warn("[PayPal] findPayPalSessionForCart failed:", e?.message)
    return null
  }
}

async function updatePayPalSession(
  sessionId: string,
  status: string,
  extraData: Record<string, any>,
  scope: any
): Promise<void> {
  try {
    const paymentModule = scope.resolve(Modules.PAYMENT) as IPaymentModuleService
    const [existing] = await paymentModule.listPaymentSessions({ id: [sessionId] }, { take: 1 })
    const mergedData = { ...(existing?.data || {}), ...extraData }
    await (paymentModule as any).updatePaymentSession({
      id: sessionId,
      data: mergedData,
      status: status as any,
      amount: existing?.amount,
      currency_code: existing?.currency_code,
    })
  } catch (e: any) {
    console.error("[PayPal] updatePayPalSession failed:", e?.message)
  }
}

async function attachPayPalCaptureToSession(
  cartId: string,
  orderId: string,
  capture: any,
  scope: any
) {
  try {
    const session = await findPayPalSessionForCart(cartId, scope)
    if (!session) {
      console.warn("[PayPal] attachPayPalCaptureToSession: no session found for cart", cartId)
      return
    }

    const captureId = capture?.purchase_units?.[0]?.payments?.captures?.[0]?.id || capture?.id

    await updatePayPalSession(
      session.session_id,
      "captured",
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

  } catch {
  }
}

async function attachPayPalAuthorizationToSession(
  cartId: string,
  orderId: string,
  authorization: any,
  scope: any
) {
  try {
    const session = await findPayPalSessionForCart(cartId, scope)
    if (!session) {
      console.warn("[PayPal] attachPayPalAuthorizationToSession: no session found for cart", cartId)
      return
    }

    const authorizationId = authorization?.purchase_units?.[0]?.payments?.authorizations?.[0]?.id

    await updatePayPalSession(
      session.session_id,
      "authorized",
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

  } catch {
  }
}

async function getExistingCapture(cartId: string, orderId: string, scope: any) {
  try {
    const session = await findPayPalSessionForCart(cartId, scope)
    if (!session) return null

    const paypalData = (session.session_data || {}).paypal || {}
    const existingOrderId = String(paypalData.order_id || "")
    if (existingOrderId && existingOrderId !== orderId) return null
    if (paypalData.capture) return paypalData.capture
    if (paypalData.capture_id) return { id: paypalData.capture_id }
    return null
  } catch {
    return null
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const paypal = req.scope.resolve<PayPalModuleService>("paypal_onboarding")
  const { scope } = req
  let debugId: string | null = null

  try {
    const body = (req.body || {}) as Body
    const cartId = body.cart_id
    const orderId = body.order_id

    if (!cartId || !orderId) {
      return res.status(400).json({ message: "cart_id and order_id are required" })
    }

    const existingCapture = await getExistingCapture(cartId, orderId, scope)
    if (existingCapture) {
      return res.json({ capture: existingCapture })
    }

    const creds = await paypal.getActiveCredentials()
    const { accessToken, base } = await getPayPalAccessToken(creds)
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

    const requestId = resolveIdempotencyKey(req, "capture-order", `pp-capture-${orderId}`)
    const endpoint =
      paymentAction === "authorize"
        ? `${base}/v2/checkout/orders/${orderId}/authorize`
        : `${base}/v2/checkout/orders/${orderId}/capture`

    const ppResp = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": requestId,
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
    if (paymentAction === "authorize") {
      await attachPayPalAuthorizationToSession(cartId, orderId, payload, req.scope)
    } else {
      await attachPayPalCaptureToSession(cartId, orderId, payload, req.scope)
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
    try {
      const body = (req.body || {}) as Body
      await paypal.recordAuditEvent("capture_order_failed", {
        cart_id: body.cart_id,
        order_id: body.order_id,
        debug_id: debugId,
        message: e?.message || String(e),
      })
      await paypal.recordMetric("capture_order_failed")
    } catch {
    }
    return res.status(500).json({ message: e?.message || "Failed to capture PayPal order" })
  }
}
