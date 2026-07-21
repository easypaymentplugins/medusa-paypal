"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
async function POST(req, res) {
    try {
        const paypal = req.scope.resolve("paypal_onboarding");
        await paypal.disconnect();
        return res.json({ ok: true });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error("[PayPal] disconnect failed:", message);
        return res.status(500).json({ message: "Failed to disconnect PayPal" });
    }
}
//# sourceMappingURL=route.js.map