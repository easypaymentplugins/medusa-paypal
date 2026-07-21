"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
async function GET(req, res) {
    const paypal = req.scope.resolve("paypal_onboarding");
    try {
        const settings = await paypal.getSettings();
        const data = (settings?.data || {});
        const additionalSettings = (data.additional_settings || {});
        const advancedCard = (data.advanced_card_payments || {});
        return res.json({
            paymentAction: additionalSettings.paymentAction === "authorize" ? "authorize" : "capture",
            advancedCardEnabled: advancedCard.enabled !== false,
        });
    }
    catch {
        return res.status(500).json({ message: "Failed to load PayPal settings" });
    }
}
//# sourceMappingURL=route.js.map