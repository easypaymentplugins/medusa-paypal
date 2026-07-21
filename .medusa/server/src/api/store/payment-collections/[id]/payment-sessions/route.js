"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const http_1 = require("@medusajs/framework/http");
const utils_1 = require("@medusajs/framework/utils");
const core_workflow_1 = require("../../../../../modules/paypal/utils/core-workflow");
const defaultPaymentCollectionFields = [
    "id",
    "currency_code",
    "amount",
    "*payment_sessions",
];
async function POST(req, res) {
    const collectionId = req.params.id;
    const { provider_id, data } = req.body;
    if (!provider_id || typeof provider_id !== "string") {
        throw new utils_1.MedusaError(utils_1.MedusaError.Types.INVALID_DATA, "provider_id is required to create a payment session");
    }
    try {
        await (0, core_workflow_1.runCoreWorkflow)(req.scope, "create-payment-sessions", {
            payment_collection_id: collectionId,
            provider_id,
            customer_id: req.auth_context?.actor_id,
            data,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new utils_1.MedusaError(utils_1.MedusaError.Types.UNEXPECTED_STATE, `Failed to create payment session for provider '${provider_id}': ${message}`);
    }
    const paymentCollection = await (0, http_1.refetchEntity)({
        entity: "payment_collection",
        idOrFilter: collectionId,
        scope: req.scope,
        fields: req.queryConfig?.fields ?? defaultPaymentCollectionFields,
    });
    res.status(200).json({
        payment_collection: paymentCollection,
    });
}
//# sourceMappingURL=route.js.map