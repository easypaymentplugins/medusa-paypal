import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type PayPalModuleService from "../../../../modules/paypal/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const paypal = req.scope.resolve<PayPalModuleService>("paypal_onboarding")
  try {
    const settings = await paypal.getSettings()
    const data = (settings?.data || {}) as Record<string, any>
    const additionalSettings = (data.additional_settings || {}) as Record<string, any>
    const advancedCard = (data.advanced_card_payments || {}) as Record<string, any>

    return res.json({
      paymentAction: additionalSettings.paymentAction === "authorize" ? "authorize" : "capture",
      advancedCardEnabled: advancedCard.enabled === true,
    })
  } catch (e: any) {
    return res.status(500).json({ message: e?.message || "Failed to load PayPal settings" })
  }
}
