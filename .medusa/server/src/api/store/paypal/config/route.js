"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const currencies_1 = require("../../../../modules/paypal/utils/currencies");
async function GET(req, res) {
    const paypal = req.scope.resolve("paypal_onboarding");
    try {
        const creds = await paypal.getActiveCredentials();
        const apiDetails = await paypal.getApiDetails().catch(() => null);
        const cartId = req.query?.cart_id || "";
        const query = req.scope.resolve("query");
        let currency = (0, currencies_1.normalizeCurrencyCode)(apiDetails?.apiDetails?.currency_code || process.env.PAYPAL_CURRENCY || "EUR");
        if (cartId) {
            const { data: carts } = await query.graph({
                entity: "cart",
                fields: ["id", "currency_code", "region.currency_code"],
                filters: { id: cartId },
            });
            const cart = carts?.[0];
            if (cart) {
                currency = (0, currencies_1.normalizeCurrencyCode)(cart.region?.currency_code || cart.currency_code || currency);
            }
        }
        const compatibility = (0, currencies_1.getPayPalCurrencyCompatibility)({
            currencyCode: currency,
            paypalCurrencyOverride: apiDetails?.apiDetails?.currency_code || process.env.PAYPAL_CURRENCY,
        });
        const settings = await paypal.getSettings().catch(() => ({}));
        const data = settings && typeof settings === "object" && "data" in settings
            ? (settings.data || {})
            : {};
        const additionalSettings = data && typeof data === "object"
            ? (data.additional_settings || {})
            : {};
        const paypalSettings = data && typeof data === "object"
            ? (data.paypal_settings || {})
            : {};
        const paymentAction = typeof additionalSettings.paymentAction === "string"
            ? additionalSettings.paymentAction
            : "capture";
        if (paypalSettings.enabled === false) {
            return res.status(403).json({ message: "PayPal is currently disabled." });
        }
        const advancedCardSettings = data && typeof data === "object"
            ? (data.advanced_card_payments || {})
            : {};
        const cardEnabled = advancedCardSettings.enabled !== false;
        const cardThreeDS = typeof advancedCardSettings.threeDS === "string"
            ? advancedCardSettings.threeDS
            : "when_required";
        // The client_token grants the browser SDK API access and is only needed to
        // render the Advanced (hosted) Card Fields. Generate/expose it only when
        // card payments are enabled — the PayPal buttons flow uses just client_id —
        // so an unauthenticated config fetch doesn't hand out a token it won't use.
        const client_token = cardEnabled
            ? await paypal.generateClientToken({ locale: "en_US" }).catch(() => "")
            : "";
        return res.json({
            environment: creds.environment,
            client_id: creds.client_id,
            currency: compatibility.currency,
            currency_supported: compatibility.supported,
            currency_errors: compatibility.errors,
            supported_currencies: (0, currencies_1.getPayPalSupportedCurrencies)(),
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
            // Funding sources to disable in the PayPal JS SDK (e.g. ["card",
            // "paylater"]). The UI package has always read this field; emit it so
            // the setting actually takes effect.
            disable_buttons: Array.isArray(paypalSettings.disableButtons)
                ? paypalSettings.disableButtons.map((b) => String(b))
                : Array.isArray(paypalSettings.disable_buttons)
                    ? paypalSettings.disable_buttons.map((b) => String(b))
                    : [],
        });
    }
    catch {
        return res.status(500).json({ message: "Failed to load PayPal config" });
    }
}
//# sourceMappingURL=route.js.map