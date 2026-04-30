import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type PayPalModuleService from "../../../../modules/paypal/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const paypal = req.scope.resolve<PayPalModuleService>("paypal_onboarding")
    const status = await paypal.getStatus()
    return res.json(status)
  } catch (e: any) {
    console.error("[paypal_onboarding] onboarding-status error:", e?.message || e, e?.stack)
    return res.json({
      environment: "live",
      status: "disconnected",
      error: e?.message || "Unknown error",
    })
  }
}
