"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findPayPalSessionForCart = findPayPalSessionForCart;
exports.getStoredPayPalOrderId = getStoredPayPalOrderId;
exports.updatePayPalSessionData = updatePayPalSessionData;
const utils_1 = require("@medusajs/framework/utils");
const provider_ids_1 = require("./provider-ids");
/**
 * Resolve the cart's active PayPal payment session (wallet or card). When a
 * cart has more than one PayPal session, the most recently created one wins —
 * both create-order and capture-order rely on this same selection so they
 * always read and write the same session.
 */
async function findPayPalSessionForCart(cartId, scope) {
    try {
        const query = scope.resolve("query");
        const { data: carts } = await query.graph({
            entity: "cart",
            fields: [
                "id",
                "payment_collection.payment_sessions.id",
                "payment_collection.payment_sessions.data",
                "payment_collection.payment_sessions.status",
                "payment_collection.payment_sessions.provider_id",
                "payment_collection.payment_sessions.created_at",
            ],
            filters: { id: cartId },
        });
        const cart = carts?.[0];
        const sessions = cart?.payment_collection?.payment_sessions || [];
        const session = sessions
            .filter((s) => (0, provider_ids_1.isPayPalProviderId)(s.provider_id))
            .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0];
        if (!session)
            return null;
        return {
            session_id: session.id,
            session_data: (session.data || {}),
            session_status: session.status,
        };
    }
    catch (e) {
        console.warn("[PayPal] findPayPalSessionForCart failed:", e?.message);
        return null;
    }
}
/**
 * Read the PayPal order id stored on a session's `data`. Accepts both the
 * canonical `data.paypal.order_id` and the legacy top-level `data.order_id`.
 * Returns null when none is present.
 */
function getStoredPayPalOrderId(sessionData) {
    const paypal = (sessionData?.paypal || {});
    const id = String(paypal.order_id || sessionData?.order_id || "");
    return id || null;
}
/**
 * Shallow-merge `extraData` into a payment session's `data`, preserving the
 * session's amount/currency. Callers that update the nested `paypal` object are
 * responsible for spreading its existing keys (see `getStoredPayPalOrderId`).
 *
 * The write is retried a few times before giving up: when this runs right after
 * a successful PayPal capture, a transient DB blip that loses the write means
 * the money is captured but Medusa never records it. A bounded retry closes the
 * common transient-failure window; if every attempt fails the error is
 * re-thrown (with a CRITICAL log for capture/order data) so the caller can react
 * — the webhook and paypal-complete's live re-derivation remain the backstop.
 */
const SESSION_UPDATE_MAX_ATTEMPTS = 3;
const SESSION_UPDATE_BASE_DELAY_MS = 200;
async function updatePayPalSessionData(sessionId, extraData, scope) {
    const paymentModule = scope.resolve(utils_1.Modules.PAYMENT);
    let lastError;
    for (let attempt = 1; attempt <= SESSION_UPDATE_MAX_ATTEMPTS; attempt++) {
        try {
            const [existing] = await paymentModule.listPaymentSessions({ id: [sessionId] }, { take: 1 });
            const mergedData = { ...(existing?.data || {}), ...extraData };
            await paymentModule.updatePaymentSession({
                id: sessionId,
                data: mergedData,
                amount: existing?.amount,
                currency_code: existing?.currency_code,
            });
            return;
        }
        catch (e) {
            lastError = e;
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[PayPal] updatePayPalSessionData attempt ${attempt}/${SESSION_UPDATE_MAX_ATTEMPTS} failed:`, msg);
            if (attempt < SESSION_UPDATE_MAX_ATTEMPTS) {
                await new Promise((r) => setTimeout(r, SESSION_UPDATE_BASE_DELAY_MS * attempt));
            }
        }
    }
    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    console.error("[PayPal] updatePayPalSessionData failed after retries:", msg);
    const hasCaptureData = "capture_id" in extraData || "order_id" in extraData;
    if (hasCaptureData) {
        console.error("[PayPal] CRITICAL: Payment data (capture/order) was NOT persisted to session.", { sessionId, keys: Object.keys(extraData) });
    }
    throw lastError;
}
//# sourceMappingURL=payment-session.js.map