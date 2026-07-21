"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayPalProviderBase = void 0;
const utils_1 = require("@medusajs/framework/utils");
const crypto_1 = require("crypto");
const amounts_1 = require("../utils/amounts");
const currencies_1 = require("../utils/currencies");
const credential_resolver_1 = require("../utils/credential-resolver");
const partner_1 = require("../utils/partner");
const paypal_fetch_1 = require("../utils/paypal-fetch");
const webhook_utils_1 = require("./webhook-utils");
const status_utils_1 = require("./status-utils");
/**
 * Shared base for the two PayPal payment providers (wallet buttons and advanced
 * card fields). Both providers ran nearly identical credential/token handling,
 * order-detail fetching, idempotency-key generation, amount normalization, and
 * PayPal→Medusa status mapping — that logic lives here once. Each provider
 * supplies its own `sessionPrefix` / `idempotencyPrefix` and keeps the pieces
 * that genuinely differ (create/authorize/capture/refund/cancel business logic,
 * metric recording, 3-D Secure handling, provider-id passthrough).
 */
class PayPalProviderBase extends utils_1.AbstractPaymentProvider {
    options_;
    paypal;
    constructor(cradle, options) {
        super(cradle, options);
        this.options_ = options;
        const pg = PayPalProviderBase.resolvePgConnection(cradle);
        this.paypal = new credential_resolver_1.PayPalCredentialResolver(pg);
    }
    static resolvePgConnection(cradle) {
        for (const key of ["__pg_connection__", "pgConnection", "pg_connection"]) {
            try {
                const val = cradle[key];
                if (val)
                    return val;
            }
            catch { }
        }
        throw new Error("Could not resolve pgConnection from the payment module container. " +
            "Ensure the paypal module is registered in medusa-config and the database is accessible.");
    }
    generateSessionId() {
        try {
            return (0, crypto_1.randomUUID)();
        }
        catch {
            return `${this.sessionPrefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        }
    }
    async resolveSettings() {
        return this.paypal.getSettings();
    }
    async resolveCurrencyOverride() {
        const { apiDetails } = await this.resolveSettings();
        const code = apiDetails.currency_code;
        if (typeof code === "string" && code.trim()) {
            return (0, currencies_1.normalizeCurrencyCode)(code);
        }
        return (0, currencies_1.normalizeCurrencyCode)(process.env.PAYPAL_CURRENCY || "EUR");
    }
    async getPayPalAccessToken() {
        return this.paypal.getAccessToken();
    }
    async getOrderDetails(orderId) {
        const { accessToken, base } = await this.getPayPalAccessToken();
        const resp = await (0, paypal_fetch_1.paypalFetch)(`${base}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "PayPal-Partner-Attribution-Id": partner_1.PAYPAL_PARTNER_ATTRIBUTION_ID,
            },
        });
        const text = await resp.text();
        if (!resp.ok) {
            throw new Error(`PayPal get order error (${resp.status}): ${text}`);
        }
        return JSON.parse(text);
    }
    getIdempotencyKey(input, suffix) {
        const key = input?.context?.idempotency_key?.trim();
        if (key) {
            return `${key}-${suffix}`;
        }
        return `${this.idempotencyPrefix}-${suffix}-${this.generateSessionId()}`;
    }
    async normalizePaymentData(input) {
        const data = (input.data || {});
        const amount = (0, amounts_1.toAmountNumber)(data.amount);
        const currencyOverride = await this.resolveCurrencyOverride();
        const currencyCode = (0, currencies_1.normalizeCurrencyCode)(data.currency_code || currencyOverride || "EUR");
        (0, currencies_1.assertPayPalCurrencySupported)({
            currencyCode,
            paypalCurrencyOverride: currencyOverride,
        });
        return { data, amount, currencyCode };
    }
    formatAmount(amount, currencyCode) {
        return (0, amounts_1.formatAmountForPayPal)(amount, currencyCode || "EUR");
    }
    /**
     * Amount to send to PayPal for a capture. Medusa invokes the provider's
     * capturePayment with only `{ data, context: { idempotency_key } }` — the
     * admin's requested (possibly partial) capture amount is never passed in the
     * input. The idempotency_key IS the Medusa `capture` row id, so resolve the
     * requested amount from that row; otherwise a partial capture would silently
     * charge the buyer the full session total. Falls back to the session amount
     * when the row can't be resolved (preserving full-capture behavior), and
     * never returns more than the session amount.
     */
    async resolveRequestedCaptureAmount(input, sessionAmount) {
        const captureRowId = input?.context?.idempotency_key?.trim();
        if (!captureRowId)
            return sessionAmount;
        const requested = await this.paypal.getRequestedCaptureAmount(captureRowId);
        if (requested === null || !Number.isFinite(requested) || requested <= 0) {
            return sessionAmount;
        }
        return Math.min(requested, sessionAmount);
    }
    /**
     * When the session amount or currency changes while a not-yet-approved PayPal
     * order is stored on the session, drop the stored order reference so the next
     * create-order call mints a fresh order at the correct total. Without this, a
     * buyer who opens PayPal (order created for the old total), backs out, and
     * changes the cart gets charged the stale amount. Returns a `{ paypal }`
     * patch to spread into the updated session data, or `{}` when nothing needs
     * invalidating. Sessions that already carry a capture/authorization are never
     * touched.
     */
    invalidateStaleOrder(input, nextCurrencyCode) {
        const data = (input.data || {});
        const paypal = (data.paypal || {});
        if (!paypal.order_id)
            return {};
        if (paypal.capture_id || paypal.authorization_id)
            return {};
        const prevAmount = (0, amounts_1.toAmountNumber)(data.amount);
        const nextAmount = (0, amounts_1.toAmountNumber)(input.amount);
        const prevCurrency = String(data.currency_code || "").toUpperCase();
        const amountChanged = prevAmount > 0 && nextAmount > 0 && prevAmount !== nextAmount;
        const currencyChanged = !!prevCurrency && prevCurrency !== nextCurrencyCode;
        if (!amountChanged && !currencyChanged)
            return {};
        const { order_id: _orderId, order: _order, ...rest } = paypal;
        return { paypal: rest };
    }
    mapCaptureStatus(status) {
        // Delegate to the shared, unit-tested mapping so the card and wallet
        // providers agree with each other and with the webhook processor. Notably a
        // PARTIALLY_REFUNDED capture must stay "captured" (only part of the funds
        // were returned) — mapping it to "canceled" would wrongly unwind a live
        // capture.
        return (0, status_utils_1.mapPayPalCaptureStatus)(status);
    }
    mapAuthorizationStatus(status) {
        const normalized = String(status || "").toUpperCase();
        if (!normalized)
            return null;
        if (["CREATED", "APPROVED", "PENDING"].includes(normalized))
            return "authorized";
        if (["VOIDED", "EXPIRED"].includes(normalized))
            return "canceled";
        if (["DENIED", "DECLINED", "FAILED"].includes(normalized))
            return "error";
        return null;
    }
    mapOrderStatus(status) {
        const normalized = String(status || "").toUpperCase();
        if (!normalized)
            return "pending";
        if (normalized === "COMPLETED")
            return "captured";
        if (normalized === "APPROVED")
            return "authorized";
        if (["VOIDED", "CANCELLED"].includes(normalized))
            return "canceled";
        if (["CREATED", "SAVED", "PAYER_ACTION_REQUIRED"].includes(normalized))
            return "pending";
        if (["FAILED", "EXPIRED"].includes(normalized))
            return "error";
        return "pending";
    }
    async createAccountHolder(input) {
        const customerId = input.context?.customer?.id;
        const externalId = customerId
            ? `paypal_${customerId}`
            : `paypal_${this.generateSessionId()}`;
        return {
            id: externalId,
            data: {
                email: input.context?.customer?.email || null,
                customer_id: customerId || null,
            },
        };
    }
    async deletePayment(_input) {
        return { data: {} };
    }
    async getWebhookActionAndData(payload) {
        return (0, webhook_utils_1.getPayPalWebhookActionAndData)(payload);
    }
}
exports.PayPalProviderBase = PayPalProviderBase;
//# sourceMappingURL=base-provider.js.map