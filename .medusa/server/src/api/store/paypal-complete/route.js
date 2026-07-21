"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const utils_1 = require("@medusajs/framework/utils");
const crypto_1 = require("crypto");
const provider_ids_1 = require("../../../modules/paypal/utils/provider-ids");
const core_workflow_1 = require("../../../modules/paypal/utils/core-workflow");
async function POST(req, res) {
    const logger = req.scope.resolve(utils_1.ContainerRegistrationKeys.LOGGER);
    const requestId = (0, crypto_1.randomUUID)();
    const { cart_id } = (req.body || {});
    if (!cart_id || typeof cart_id !== "string") {
        return res.status(400).json({ message: "cart_id is required" });
    }
    if (!cart_id.startsWith("cart_")) {
        return res.status(400).json({ message: "Invalid cart_id format" });
    }
    try {
        const query = req.scope.resolve("query");
        const { data: carts } = await query.graph({
            entity: "cart",
            fields: [
                "id",
                "completed_at",
                "payment_collection.payment_sessions.id",
                "payment_collection.payment_sessions.data",
                "payment_collection.payment_sessions.status",
                "payment_collection.payment_sessions.provider_id",
                "payment_collection.payment_sessions.created_at",
                "payment_collection.payment_sessions.amount",
                "payment_collection.payment_sessions.currency_code",
            ],
            filters: { id: cart_id },
        });
        const cart = carts?.[0];
        if (cart?.completed_at) {
            return res.json({ success: true, cart_id, already_completed: true });
        }
        const sessions = cart?.payment_collection?.payment_sessions || [];
        const session = sessions
            .filter((s) => (0, provider_ids_1.isPayPalProviderId)(s.provider_id))
            .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0];
        if (!session) {
            return res.status(400).json({ message: "No PayPal payment session found for cart" });
        }
        const paymentModule = req.scope.resolve(utils_1.Modules.PAYMENT);
        // Do NOT fabricate captured_at/authorized_at here. The authoritative
        // timestamp and status are set by the provider's authorizePayment (invoked
        // via authorizePaymentSession below) only after it verifies the capture /
        // authorization against PayPal. Stamping it ourselves would mark an unpaid
        // session as paid.
        const currentStatus = String(session.status || "");
        if (currentStatus !== "authorized") {
            try {
                await paymentModule.authorizePaymentSession(session.id, {});
                logger.info(`[paypal] paypal-complete authorizePaymentSession succeeded (request_id=${requestId}, session_id=${session.id})`);
            }
            catch (e) {
                // Authorization is the gate for completion; if it fails, the
                // completeCartWorkflow below fails too and we report that honestly.
                logger.warn(`[paypal] paypal-complete authorizePaymentSession failed (request_id=${requestId}, session_id=${session.id}): ${e?.message ?? String(e)}`);
            }
        }
        try {
            const { result } = await (0, core_workflow_1.runCoreWorkflow)(req.scope, "complete-cart", { id: cart_id });
            logger.info(`[paypal] paypal-complete cart completed (request_id=${requestId}, cart_id=${cart_id}, order_id=${result?.id})`);
            return res.json({ success: true, cart_id, order_id: result?.id, request_id: requestId });
        }
        catch (e) {
            // The cart may have been completed by a concurrent request between our
            // initial check and now — treat that as success, not an error.
            const recheck = await query
                .graph({ entity: "cart", fields: ["id", "completed_at"], filters: { id: cart_id } })
                .catch(() => ({ data: [] }));
            if (recheck?.data?.[0]?.completed_at) {
                return res.json({ success: true, cart_id, already_completed: true, request_id: requestId });
            }
            logger.error(`[paypal] paypal-complete completeCartWorkflow failed (request_id=${requestId}, cart_id=${cart_id}): ${e?.message ?? String(e)}`, e instanceof Error ? e : undefined);
            // The payment may have been captured at PayPal but the order was not
            // finalized. Report failure (not a false success) so the storefront can
            // surface a "payment taken, contact support" state.
            return res.status(500).json({
                success: false,
                cart_id,
                session_id: session.id,
                message: "Payment was processed but the order could not be finalized.",
                request_id: requestId,
            });
        }
    }
    catch (e) {
        logger.error(`[paypal] paypal-complete failed (request_id=${requestId}, cart_id=${cart_id}): ${e?.message ?? String(e)}`, e instanceof Error ? e : undefined);
        return res.status(500).json({ message: "Internal error", request_id: requestId });
    }
}
//# sourceMappingURL=route.js.map