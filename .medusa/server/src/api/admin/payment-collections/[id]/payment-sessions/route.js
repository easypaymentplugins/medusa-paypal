"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const core_workflow_1 = require("../../../../../modules/paypal/utils/core-workflow");
const ALLOWED_PROVIDERS = new Set([
    "pp_paypal_paypal",
    "pp_paypal_card_paypal_card",
]);
async function POST(req, res) {
    const collectionId = req.params.id;
    const { provider_id, data, customer_id } = req.body;
    if (!provider_id || !ALLOWED_PROVIDERS.has(provider_id)) {
        return res.status(400).json({ message: "Invalid or unsupported provider_id" });
    }
    if (!collectionId || typeof collectionId !== "string") {
        return res.status(400).json({ message: "Invalid collection id" });
    }
    try {
        const { result } = await (0, core_workflow_1.runCoreWorkflow)(req.scope, "create-payment-sessions", {
            payment_collection_id: collectionId,
            provider_id,
            customer_id,
            data,
        });
        res.status(200).json({ payment_session: result });
    }
    catch {
        res.status(500).json({ message: "Failed to create payment session" });
    }
}
//# sourceMappingURL=route.js.map