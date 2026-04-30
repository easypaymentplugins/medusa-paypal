import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type PayPalModuleService from "../../../../modules/paypal/service"

type Body = {
  environment?: "sandbox" | "live"
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const paypal = req.scope.resolve<PayPalModuleService>("paypal_onboarding")
  const status = await paypal.getStatus()
  return res.json({ environment: status.environment })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const paypal = req.scope.resolve<PayPalModuleService>("paypal_onboarding")
    const body = (req.body || {}) as Body
    const env = body.environment === "sandbox" ? "sandbox" : "live"
    await paypal.setEnvironment(env)
    const status = await paypal.getStatus()
    return res.json(status)
  } catch (e: any) {
    return res.status(500).json({ message: e?.message || "Unknown error" })
  }
}
