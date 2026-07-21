"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
async function GET(req, res) {
    try {
        const paypal = req.scope.resolve("paypal_onboarding");
        const status = await paypal.getStatus();
        return res.json({ environment: status.environment });
    }
    catch {
        // This GET runs on every connection-page load; an unguarded rejection here
        // (no connection row yet, transient DB / decrypt error) would surface as an
        // unhandled 500. Fail soft so the admin page can still render.
        return res.status(500).json({ message: "Failed to load environment" });
    }
}
async function POST(req, res) {
    try {
        const paypal = req.scope.resolve("paypal_onboarding");
        const body = (req.body || {});
        const env = body.environment === "sandbox" ? "sandbox" : "live";
        await paypal.setEnvironment(env);
        const status = await paypal.getStatus();
        return res.json(status);
    }
    catch {
        return res.status(500).json({ message: "Failed to update environment" });
    }
}
//# sourceMappingURL=route.js.map