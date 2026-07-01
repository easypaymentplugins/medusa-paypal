import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type PayPalModuleService from "../../../../modules/paypal/service"

type Body = {
  environment?: "sandbox" | "live"
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const paypal = req.scope.resolve<PayPalModuleService>("paypal_onboarding")
    const status = await paypal.getStatus()
    return res.json({ environment: status.environment })
  } catch {
    // This GET runs on every connection-page load; an unguarded rejection here
    // (no connection row yet, transient DB / decrypt error) would surface as an
    // unhandled 500. Fail soft so the admin page can still render.
    return res.status(500).json({ message: "Failed to load environment" })
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const paypal = req.scope.resolve<PayPalModuleService>("paypal_onboarding")
    const body = (req.body || {}) as Body
    const env = body.environment === "sandbox" ? "sandbox" : "live"
    await paypal.setEnvironment(env)
    const status = await paypal.getStatus()
    return res.json(status)
  } catch {
    return res.status(500).json({ message: "Failed to update environment" })
  }
}
