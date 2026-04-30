import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type PayPalModuleService from "../../../../modules/paypal/service"

export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  return res.status(405).json({
    message:
      "Method Not Allowed. Use POST with JSON: { authCode, sharedId, env }. This endpoint is called by the PayPal onboarding callback.",
  })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const paypal = req.scope.resolve<PayPalModuleService>("paypal_onboarding")
  const body = req.body as { authCode?: string; sharedId?: string; env?: "sandbox" | "live" }

  if (!body?.authCode || !body?.sharedId) {
    return res.status(400).json({ message: "Missing authCode/sharedId" })
  }

  try {

    await paypal.exchangeAndSaveSellerCredentials({
      authCode: body.authCode,
      sharedId: body.sharedId,
      env: body.env,
    })

    return res.json({ ok: true })
  } catch (e: any) {
    console.error("[PayPal] onboard-complete failed", e)
    return res.status(500).json({
      message: e?.message || "Failed to exchange and save PayPal credentials",
    })
  }
}
