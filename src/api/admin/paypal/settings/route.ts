import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type PayPalModuleService from "../../../../modules/paypal/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const paypal = req.scope.resolve<PayPalModuleService>("paypal_onboarding")
    return res.json(await paypal.getSettings())
  } catch (e: unknown) {
    console.error("[PayPal] settings GET failed:", e instanceof Error ? e.message : e)
    return res.status(500).json({ message: "Failed to load PayPal settings" })
  }
}

const ALLOWED_SETTINGS_KEYS = new Set([
  "additional_settings",
  "paypal_settings",
  "advanced_card_payments",
  "pay_later_messaging",
  "apple_pay",
  "google_pay",
  "api_details",
])

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const paypal = req.scope.resolve<PayPalModuleService>("paypal_onboarding")

  const raw = (req.body && typeof req.body === "object") ? (req.body as Record<string, unknown>) : {}
  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(raw)) {
    if (ALLOWED_SETTINGS_KEYS.has(key)) {
      patch[key] = raw[key]
    }
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ message: "No valid settings fields provided" })
  }

  try {
    return res.json(await paypal.saveSettings(patch as Record<string, Record<string, unknown>>))
  } catch (e: unknown) {
    console.error("[PayPal] settings POST failed:", e instanceof Error ? e.message : e)
    return res.status(500).json({ message: "Failed to save PayPal settings" })
  }
}
