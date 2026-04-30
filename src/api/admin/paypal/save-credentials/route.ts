import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type PayPalModuleService from "../../../../modules/paypal/service"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const paypal = req.scope.resolve<PayPalModuleService>("paypal_onboarding")
  const body = req.body as {
    clientId?: string
    clientSecret?: string
    environment?: "sandbox" | "live"
  }

  if (!body?.clientId || !body?.clientSecret) {
    return res.status(400).json({ message: "Missing clientId/clientSecret" })
  }

  await paypal.saveAndHydrateSellerCredentials({
    clientId: body.clientId,
    clientSecret: body.clientSecret,
    environment: body.environment,
  })
  return res.json({ ok: true })
}
