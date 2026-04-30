import type {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type PayPalModuleService from "../../../../modules/paypal/service"

type Body = {
  email?: string
  products?: string[]
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const paypal = req.scope.resolve<PayPalModuleService>("paypal_onboarding")
    const body = (req.body || {}) as Body
    const authEmail =
      typeof req.auth_context?.user_metadata?.email === "string"
        ? String(req.auth_context.user_metadata.email)
        : undefined
    const email = authEmail ?? body.email ?? "admin@paypal.com"

    const link = await paypal.createOnboardingLink({
      email,
      products: body.products,
    })

    return res.json({
      status: "pending",
      onboarding_url: link.onboarding_url,
      return_url: link.return_url,
    })
  } catch (e: any) {
    console.error("[paypal_onboarding] onboarding-link error:", e?.message || e, e?.stack)
    return res.status(500).json({
      message: e?.message || "Unknown error",
    })
  }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  return res.status(405).json({
    message: "Use POST /admin/paypal/onboarding-link",
  })
}
