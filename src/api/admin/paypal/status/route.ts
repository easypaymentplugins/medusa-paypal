import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type PayPalModuleService from "../../../../modules/paypal/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const paypal = req.scope.resolve<PayPalModuleService>("paypal_onboarding")

  const q = (req.query || {}) as Record<string, any>
  const envParam = (q.environment || q.env) as string | undefined
  const env = envParam === "live" ? "live" : envParam === "sandbox" ? "sandbox" : undefined

  return res.json(await paypal.getStatus(env))
}
