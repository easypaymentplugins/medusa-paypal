import type { IPaymentModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { isPayPalProviderId } from "./provider-ids"

/**
 * Shared PayPal payment-session helpers.
 *
 * `create-order` and `capture-order` must agree on (a) which payment session
 * belongs to a cart and (b) how the PayPal order id is stored/read on it —
 * otherwise the capture's fail-closed binding (the order id stored by
 * create-order must equal the one being captured) can never be satisfied.
 * Keeping the logic here, resolved through the Payment module service
 * (`Modules.PAYMENT`), guarantees both routes use the same, correct path.
 */

export type PayPalCartSession = {
  session_id: string
  session_data: Record<string, any>
  session_status: string
}

/**
 * Resolve the cart's active PayPal payment session (wallet or card). When a
 * cart has more than one PayPal session, the most recently created one wins —
 * both create-order and capture-order rely on this same selection so they
 * always read and write the same session.
 */
export async function findPayPalSessionForCart(
  cartId: string,
  scope: any
): Promise<PayPalCartSession | null> {
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

/**
 * Read the PayPal order id stored on a session's `data`. Accepts both the
 * canonical `data.paypal.order_id` and the legacy top-level `data.order_id`.
 * Returns null when none is present.
 */
export function getStoredPayPalOrderId(
  sessionData?: Record<string, any> | null
): string | null {
  const paypal = (sessionData?.paypal || {}) as Record<string, unknown>
  const id = String(paypal.order_id || sessionData?.order_id || "")
  return id || null
}

/**
 * Shallow-merge `extraData` into a payment session's `data`, preserving the
 * session's amount/currency. Callers that update the nested `paypal` object are
 * responsible for spreading its existing keys (see `getStoredPayPalOrderId`).
 *
 * The write is retried a few times before giving up: when this runs right after
 * a successful PayPal capture, a transient DB blip that loses the write means
 * the money is captured but Medusa never records it. A bounded retry closes the
 * common transient-failure window; if every attempt fails the error is
 * re-thrown (with a CRITICAL log for capture/order data) so the caller can react
 * — the webhook and paypal-complete's live re-derivation remain the backstop.
 */
const SESSION_UPDATE_MAX_ATTEMPTS = 3
const SESSION_UPDATE_BASE_DELAY_MS = 200

export async function updatePayPalSessionData(
  sessionId: string,
  extraData: Record<string, any>,
  scope: any
): Promise<void> {
  const paymentModule = scope.resolve(Modules.PAYMENT) as IPaymentModuleService
  let lastError: unknown

  for (let attempt = 1; attempt <= SESSION_UPDATE_MAX_ATTEMPTS; attempt++) {
    try {
      const [existing] = await paymentModule.listPaymentSessions({ id: [sessionId] }, { take: 1 })
      const mergedData = { ...(existing?.data || {}), ...extraData }
      await (paymentModule as any).updatePaymentSession({
        id: sessionId,
        data: mergedData,
        amount: existing?.amount,
        currency_code: existing?.currency_code,
      })
      return
    } catch (e: unknown) {
      lastError = e
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(
        `[PayPal] updatePayPalSessionData attempt ${attempt}/${SESSION_UPDATE_MAX_ATTEMPTS} failed:`,
        msg
      )
      if (attempt < SESSION_UPDATE_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, SESSION_UPDATE_BASE_DELAY_MS * attempt))
      }
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError)
  console.error("[PayPal] updatePayPalSessionData failed after retries:", msg)
  const hasCaptureData = "capture_id" in extraData || "order_id" in extraData
  if (hasCaptureData) {
    console.error(
      "[PayPal] CRITICAL: Payment data (capture/order) was NOT persisted to session.",
      { sessionId, keys: Object.keys(extraData) }
    )
  }
  throw lastError
}
