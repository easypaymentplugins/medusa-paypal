"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
async function GET(req, res) {
    try {
        const paypal = req.scope.resolve("paypal_onboarding");
        const q = (req.query || {});
        const envParam = (q.environment || q.env);
        const env = envParam === "live" ? "live" : envParam === "sandbox" ? "sandbox" : undefined;
        return res.json(await paypal.getStatus(env));
    }
    catch (e) {
        console.error("[PayPal] status GET failed:", e instanceof Error ? e.message : e);
        return res.status(500).json({ message: "Failed to retrieve PayPal status" });
    }
}
//# sourceMappingURL=route.js.map