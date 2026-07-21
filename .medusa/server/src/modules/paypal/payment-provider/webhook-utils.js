"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPayPalWebhookActionAndData = getPayPalWebhookActionAndData;
const EVENT_ACTIONS = {
    "CHECKOUT.ORDER.CREATED": "pending",
    "CHECKOUT.ORDER.SAVED": "pending",
    "CHECKOUT.ORDER.APPROVED": "authorized",
    "CHECKOUT.ORDER.PAYER_ACTION_REQUIRED": "pending",
    "CHECKOUT.ORDER.CANCELLED": "canceled",
    "CHECKOUT.ORDER.EXPIRED": "failed",
    "CHECKOUT.ORDER.VOIDED": "canceled",
    "CHECKOUT.ORDER.COMPLETED": "captured",
    "PAYMENT.AUTHORIZATION.CREATED": "authorized",
    "PAYMENT.AUTHORIZATION.DENIED": "failed",
    "PAYMENT.AUTHORIZATION.EXPIRED": "failed",
    "PAYMENT.AUTHORIZATION.PENDING": "pending",
    "PAYMENT.AUTHORIZATION.VOIDED": "canceled",
    "PAYMENT.CAPTURE.COMPLETED": "captured",
    "PAYMENT.CAPTURE.DENIED": "failed",
    "PAYMENT.CAPTURE.PENDING": "pending",
    "PAYMENT.CAPTURE.REFUNDED": "canceled",
    "PAYMENT.CAPTURE.REVERSED": "canceled",
    "PAYMENT.REFUND.COMPLETED": "canceled",
    "PAYMENT.REFUND.DENIED": "failed",
};
function resolveSessionId(resource) {
    return (resource?.custom_id ||
        resource?.purchase_units?.[0]?.custom_id ||
        resource?.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id ||
        resource?.purchase_units?.[0]?.payments?.authorizations?.[0]?.custom_id ||
        resource?.purchase_units?.[0]?.payments?.refunds?.[0]?.custom_id);
}
function resolveAmount(resource) {
    const amount = resource?.amount ||
        resource?.purchase_units?.[0]?.amount ||
        resource?.purchase_units?.[0]?.payments?.captures?.[0]?.amount ||
        resource?.purchase_units?.[0]?.payments?.authorizations?.[0]?.amount ||
        resource?.purchase_units?.[0]?.payments?.refunds?.[0]?.amount ||
        resource?.seller_receivable_breakdown?.gross_amount;
    const value = amount?.value ?? amount?.amount?.value;
    if (value === undefined || value === null) {
        return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function resolveCurrencyCode(resource) {
    const amount = resource?.amount ||
        resource?.purchase_units?.[0]?.amount ||
        resource?.purchase_units?.[0]?.payments?.captures?.[0]?.amount ||
        resource?.purchase_units?.[0]?.payments?.authorizations?.[0]?.amount;
    return amount?.currency_code || undefined;
}
function resolveEventType(payload) {
    const raw = payload;
    return raw?.event_type || raw?.eventType;
}
/**
 * Maps a PayPal webhook payload to the generic Medusa payment-provider webhook
 * result (the `getWebhookActionAndData` hook on AbstractPaymentProvider).
 *
 * NOTE: the authoritative webhook handling for this plugin is the dedicated
 * `/store/paypal/webhook` route (signature verification, replay window,
 * dedup, dead-letter retry). This helper exists only for the framework's
 * generic `/hooks/payment/:provider` path. The `session_id` returned here is
 * derived from the PayPal resource `custom_id`, which this plugin sets to the
 * cart id (see create-order) — so consumers must resolve the cart, not treat
 * it as a payment-session id directly.
 */
function getPayPalWebhookActionAndData(payload) {
    const eventType = resolveEventType(payload);
    if (!eventType) {
        return { action: "not_supported" };
    }
    const action = EVENT_ACTIONS[eventType];
    if (!action) {
        return { action: "not_supported" };
    }
    const resource = payload?.resource;
    const sessionId = resolveSessionId(resource);
    const amount = resolveAmount(resource);
    if (!sessionId || amount === undefined) {
        return { action: "not_supported" };
    }
    return {
        action,
        data: {
            session_id: sessionId,
            amount,
        },
    };
}
//# sourceMappingURL=webhook-utils.js.map