import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type PayPalModuleService from "../../../../modules/paypal/service"

/**
 * The PayPal onboarding `return_url` (the page the mini-browser popup lands on)
 * is the PUBLIC route `GET /store/paypal/onboard-return` — `/admin/*` routes
 * require an auth token that a top-level popup navigation cannot carry, which
 * would leave the popup stuck on a 401 page. This admin GET is therefore not part
 * of the browser flow; it only documents the contract for the POST below.
 */
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
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[PayPal] onboard-complete failed:", message)
    return res.status(500).json({
      message: "Failed to exchange and save PayPal credentials",
    })
  }
}
