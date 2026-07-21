"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
/**
 * The PayPal onboarding `return_url` (the page the mini-browser popup lands on)
 * is the PUBLIC route `GET /store/paypal/onboard-return` — `/admin/*` routes
 * require an auth token that a top-level popup navigation cannot carry, which
 * would leave the popup stuck on a 401 page. This admin GET is therefore not part
 * of the browser flow; it only documents the contract for the POST below.
 */
async function GET(_req, res) {
    return res.status(405).json({
        message: "Method Not Allowed. Use POST with JSON: { authCode, sharedId, env }. This endpoint is called by the PayPal onboarding callback.",
    });
}
// Typed as AuthenticatedMedusaRequest: every /admin/* route is gated by
// Medusa's built-in admin authentication, so this credential-exchange endpoint
// only runs for an authenticated admin. The typed request makes that contract
// explicit (and gives access to the authenticated actor if ever needed).
async function POST(req, res) {
    const paypal = req.scope.resolve("paypal_onboarding");
    const body = req.body;
    if (!body?.authCode || !body?.sharedId) {
        return res.status(400).json({ message: "Missing authCode/sharedId" });
    }
    try {
        await paypal.exchangeAndSaveSellerCredentials({
            authCode: body.authCode,
            sharedId: body.sharedId,
            env: body.env,
        });
        return res.json({ ok: true });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error("[PayPal] onboard-complete failed:", message);
        return res.status(500).json({
            message: "Failed to exchange and save PayPal credentials",
        });
    }
}
//# sourceMappingURL=route.js.map