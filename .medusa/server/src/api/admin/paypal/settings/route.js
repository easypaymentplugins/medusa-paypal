"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
async function GET(req, res) {
    try {
        const paypal = req.scope.resolve("paypal_onboarding");
        return res.json(await paypal.getSettings());
    }
    catch (e) {
        console.error("[PayPal] settings GET failed:", e instanceof Error ? e.message : e);
        return res.status(500).json({ message: "Failed to load PayPal settings" });
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
]);
async function POST(req, res) {
    const paypal = req.scope.resolve("paypal_onboarding");
    const raw = (req.body && typeof req.body === "object") ? req.body : {};
    const patch = {};
    for (const key of Object.keys(raw)) {
        if (ALLOWED_SETTINGS_KEYS.has(key)) {
            patch[key] = raw[key];
        }
    }
    if (Object.keys(patch).length === 0) {
        return res.status(400).json({ message: "No valid settings fields provided" });
    }
    try {
        return res.json(await paypal.saveSettings(patch));
    }
    catch (e) {
        console.error("[PayPal] settings POST failed:", e instanceof Error ? e.message : e);
        return res.status(500).json({ message: "Failed to save PayPal settings" });
    }
}
//# sourceMappingURL=route.js.map