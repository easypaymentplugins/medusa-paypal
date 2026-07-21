"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
exports.GET = GET;
const utils_1 = require("@medusajs/framework/utils");
async function POST(req, res) {
    try {
        const paypal = req.scope.resolve("paypal_onboarding");
        const body = (req.body || {});
        let authEmail;
        const actorId = req.auth_context?.actor_id;
        if (actorId) {
            try {
                const userModule = req.scope.resolve(utils_1.Modules.USER);
                const user = await userModule.retrieveUser(actorId);
                if (user.email && user.email.includes("@")) {
                    authEmail = user.email;
                }
            }
            catch (err) {
                console.warn("[paypal_onboarding] Could not resolve admin user email for actor", actorId, err?.message);
            }
        }
        else {
            console.warn("[paypal_onboarding] No actor_id in auth_context");
        }
        const email = authEmail || (body.email && body.email.includes("@") ? body.email : undefined);
        if (!email) {
            return res.status(400).json({
                message: "Could not determine seller email. Please provide an email in the request body.",
            });
        }
        const env = body.environment === "sandbox" || body.environment === "live"
            ? body.environment
            : undefined;
        const link = await paypal.createOnboardingLink({
            email,
            products: body.products,
            env,
        });
        return res.json({
            status: "pending",
            onboarding_url: link.onboarding_url,
            return_url: link.return_url,
        });
    }
    catch (e) {
        console.error("[paypal_onboarding] onboarding-link error:", e?.message || e, e?.stack);
        return res.status(500).json({
            message: "Failed to generate PayPal onboarding link",
        });
    }
}
async function GET(req, res) {
    return res.status(405).json({
        message: "Use POST /admin/paypal/onboarding-link",
    });
}
//# sourceMappingURL=route.js.map