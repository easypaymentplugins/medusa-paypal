import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type PayPalModuleService from "../../../../modules/paypal/service"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const paypal = req.scope.resolve<PayPalModuleService>("paypal_onboarding")
  const body = req.body as {
    clientId?: string
    clientSecret?: string
    environment?: string
  }

  if (!body?.clientId || typeof body.clientId !== "string" || body.clientId.length > 200) {
    return res.status(400).json({ message: "Invalid or missing clientId" })
  }

  if (!body?.clientSecret || typeof body.clientSecret !== "string" || body.clientSecret.length > 200) {
    return res.status(400).json({ message: "Invalid or missing clientSecret" })
  }

  const environment =
    body.environment === "sandbox" || body.environment === "live"
      ? body.environment
      : undefined

  try {
    await paypal.saveAndHydrateSellerCredentials({
      clientId: body.clientId.trim(),
      clientSecret: body.clientSecret.trim(),
      environment,
    })
    return res.json({ ok: true })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[PayPal] save-credentials failed:", message)
    return res.status(500).json({ message: "Failed to save PayPal credentials" })
  }
}
