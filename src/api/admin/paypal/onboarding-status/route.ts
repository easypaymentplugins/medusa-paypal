import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type PayPalModuleService from "../../../../modules/paypal/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const paypal = req.scope.resolve<PayPalModuleService>("paypal_onboarding")
    const status = await paypal.getStatus()
    return res.json(status)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[paypal_onboarding] onboarding-status error:", message)
    // Do NOT report a definitive `status: "disconnected"` here — a transient DB
    // or decrypt error would then look like the merchant is not connected and
    // could trigger a needless re-onboarding. Signal the error with `unknown`.
    return res.status(500).json({
      status: "unknown",
      message: "Failed to retrieve PayPal status",
    })
  }
}
