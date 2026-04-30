import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type PayPalModuleService from "../../../../modules/paypal/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const paypal = req.scope.resolve<PayPalModuleService>("paypal_onboarding")
  return res.json(await paypal.getSettings())
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const paypal = req.scope.resolve<PayPalModuleService>("paypal_onboarding")

  const patch = (req.body && typeof req.body === "object") ? (req.body as Record<string, any>) : {}
  return res.json(await paypal.saveSettings(patch))
}
