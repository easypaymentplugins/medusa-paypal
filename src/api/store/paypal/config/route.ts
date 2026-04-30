import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type PayPalModuleService from "../../../../modules/paypal/service"
import {
  getPayPalCurrencyCompatibility,
  getPayPalSupportedCurrencies,
  normalizeCurrencyCode,
} from "../../../../modules/paypal/utils/currencies"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const paypal = req.scope.resolve<PayPalModuleService>("paypal_onboarding")
  try {
    const creds = await paypal.getActiveCredentials()
    const apiDetails = await paypal.getApiDetails().catch(() => null)
    const client_token = await paypal.generateClientToken({ locale: "en_US" }).catch(() => "")
    const cartId = (req.query?.cart_id as string) || ""
    const query = req.scope.resolve("query")
    let currency = normalizeCurrencyCode(
      apiDetails?.apiDetails?.currency_code || process.env.PAYPAL_CURRENCY || "EUR"
    )
    if (cartId) {
      const { data: carts } = await query.graph({
        entity: "cart",
        fields: ["id", "currency_code", "region.currency_code"],
        filters: { id: cartId },
      })
      const cart = carts?.[0]
      if (cart) {
        currency = normalizeCurrencyCode(
          cart.region?.currency_code || cart.currency_code || currency
        )
      }
    }
    const compatibility = getPayPalCurrencyCompatibility({
      currencyCode: currency,
      paypalCurrencyOverride:
        apiDetails?.apiDetails?.currency_code || process.env.PAYPAL_CURRENCY,
    })

    const settings = await paypal.getSettings().catch(() => ({}))
    const data =
      settings && typeof settings === "object" && "data" in settings
        ? ((settings as any).data || {})
        : {}

    const additionalSettings =
      data && typeof data === "object"
        ? ((data as Record<string, any>).additional_settings || {})
        : {}

    const paypalSettings =
      data && typeof data === "object"
        ? ((data as Record<string, any>).paypal_settings || {})
        : {}

    const paymentAction =
      typeof additionalSettings.paymentAction === "string"
        ? additionalSettings.paymentAction
        : "capture"

    if (paypalSettings.enabled === false) {
      return res.status(403).json({ message: "PayPal is currently disabled." })
    }


    const advancedCardSettings =
      data && typeof data === "object"
        ? ((data as Record<string, any>).advanced_card_payments || {})
        : {}

    const cardEnabled: boolean = advancedCardSettings.enabled !== false

    const cardThreeDS =
      typeof advancedCardSettings.threeDS === "string"
        ? advancedCardSettings.threeDS
        : "when_required"

    return res.json({
      environment: creds.environment,
      client_id: creds.client_id,
      currency: compatibility.currency,
      currency_supported: compatibility.supported,
      currency_errors: compatibility.errors,
      supported_currencies: getPayPalSupportedCurrencies(),
      client_token,
      intent: paymentAction,
      paypal_enabled: paypalSettings.enabled ?? true,
      paypal_title: paypalSettings.title || "PayPal",
      card_enabled: cardEnabled,
      card_title: advancedCardSettings.title || "Credit or Debit Card",
      card_three_ds: cardThreeDS,
      button_color: paypalSettings.buttonColor || "gold",
      button_shape: paypalSettings.buttonShape || "rect",
      button_width: paypalSettings.buttonWidth || "responsive",
      button_height: paypalSettings.buttonHeight ?? 45,
      button_label: paypalSettings.buttonLabel || "paypal",
    })
  } catch (e: any) {
    return res.status(500).json({ message: e?.message || "Failed to load PayPal config" })
  }
}