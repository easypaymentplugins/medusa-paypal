import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { IPaymentModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import type PayPalModuleService from "../../../modules/paypal/service"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { cart_id } = req.body as { cart_id: string }

  if (!cart_id) {
    return res.status(400).json({ error: "cart_id is required" })
  }

  try {
    const query = req.scope.resolve("query")
    const { data: carts } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "payment_collection.payment_sessions.id",
        "payment_collection.payment_sessions.data",
        "payment_collection.payment_sessions.status",
        "payment_collection.payment_sessions.provider_id",
        "payment_collection.payment_sessions.created_at",
        "payment_collection.payment_sessions.amount",
        "payment_collection.payment_sessions.currency_code",
      ],
      filters: { id: cart_id },
    })

    const sessions = carts?.[0]?.payment_collection?.payment_sessions || []
    const session = sessions
      .filter((s: any) => String(s.provider_id || "").includes("paypal"))
      .sort(
        (a: any, b: any) =>
          new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      )[0]

    if (!session) {
      return res.status(400).json({ error: "No PayPal payment session found for cart" })
    }

    const currentStatus = String(session.status || "")
    if (currentStatus === "authorized" || currentStatus === "captured") {
      console.info("[paypal-complete] session already in terminal status:", currentStatus)
      return res.json({ success: true, session_id: session.id, status: currentStatus })
    }

    const paymentModule = req.scope.resolve(Modules.PAYMENT) as IPaymentModuleService

    const [liveSession] = await paymentModule.listPaymentSessions(
      { id: [session.id] },
      { take: 1 }
    )

    const liveData = (liveSession?.data || {}) as Record<string, any>

    const paypal = req.scope.resolve<PayPalModuleService>("paypal_onboarding")
    const settings = await paypal.getSettings().catch(() => ({}))
    const settingsData =
      settings && typeof settings === "object" && "data" in settings
        ? ((settings as { data?: Record<string, any> }).data ?? {})
        : {}
    const additionalSettings = (settingsData.additional_settings || {}) as Record<string, any>
    const paymentAction =
      typeof additionalSettings.paymentAction === "string"
        ? additionalSettings.paymentAction
        : "capture"

    const timestampKey = paymentAction === "authorize" ? "authorized_at" : "captured_at"

    if (!liveData[timestampKey]) {
      await (paymentModule as any).updatePaymentSession({
        id: session.id,
        data: {
          ...liveData,
          [timestampKey]: new Date().toISOString(),
        },
        amount: liveSession?.amount ?? session.amount,
        currency_code: liveSession?.currency_code ?? session.currency_code,
      })
    }

    try {
      await (paymentModule as any).authorizePaymentSession(session.id, {})
      console.info("[paypal-complete] authorizePaymentSession succeeded for session", session.id)
    } catch (e: any) {
      console.warn("[paypal-complete] authorizePaymentSession non-fatal:", e?.message)
    }

    return res.json({ success: true, session_id: session.id })
  } catch (e: any) {
    console.error("[paypal-complete] error:", e?.message || e)
    return res.status(500).json({ error: e?.message || "Internal error" })
  }
}
