import type {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type { IUserModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import type PayPalModuleService from "../../../../modules/paypal/service"

type Body = {
  email?: string
  products?: string[]
  environment?: "sandbox" | "live"
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const paypal = req.scope.resolve<PayPalModuleService>("paypal_onboarding")
    const body = (req.body || {}) as Body

    let authEmail: string | undefined
    const actorId = req.auth_context?.actor_id
    if (actorId) {
      try {
        const userModule = req.scope.resolve<IUserModuleService>(Modules.USER)
        const user = await userModule.retrieveUser(actorId)
        if (user.email && user.email.includes("@")) {
          authEmail = user.email
        }
      } catch (err: any) {
        console.warn(
          "[paypal_onboarding] Could not resolve admin user email for actor",
          actorId,
          err?.message
        )
      }
    } else {
      console.warn("[paypal_onboarding] No actor_id in auth_context")
    }

    const email = authEmail || (body.email && body.email.includes("@") ? body.email : undefined)
    if (!email) {
      return res.status(400).json({
        message:
          "Could not determine seller email. Please provide an email in the request body.",
      })
    }
    const env =
      body.environment === "sandbox" || body.environment === "live"
        ? body.environment
        : undefined

    const link = await paypal.createOnboardingLink({
      email,
      products: body.products,
      env,
    })

    return res.json({
      status: "pending",
      onboarding_url: link.onboarding_url,
      return_url: link.return_url,
    })
  } catch (e: any) {
    console.error("[paypal_onboarding] onboarding-link error:", e?.message || e, e?.stack)
    return res.status(500).json({
      message: "Failed to generate PayPal onboarding link",
    })
  }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  return res.status(405).json({
    message: "Use POST /admin/paypal/onboarding-link",
  })
}
