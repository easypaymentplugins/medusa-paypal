"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayPalAdvancedCardProvider = void 0;
const utils_1 = require("@medusajs/framework/utils");
const amounts_1 = require("../utils/amounts");
const currencies_1 = require("../utils/currencies");
const partner_1 = require("../utils/partner");
const paypal_fetch_1 = require("../utils/paypal-fetch");
const status_utils_1 = require("./status-utils");
const base_provider_1 = require("./base-provider");
class PayPalAdvancedCardProvider extends base_provider_1.PayPalProviderBase {
    static identifier = "paypal_card";
    sessionPrefix = "pp_card";
    idempotencyPrefix = "pp-card";
    async initiatePayment(input) {
        const currencyOverride = await this.resolveCurrencyOverride();
        const currencyCode = (0, currencies_1.normalizeCurrencyCode)(input.currency_code || currencyOverride || "EUR");
        (0, currencies_1.assertPayPalCurrencySupported)({
            currencyCode,
            paypalCurrencyOverride: currencyOverride,
        });
        return {
            id: this.generateSessionId(),
            data: {
                ...(input.data || {}),
                amount: input.amount,
                currency_code: currencyCode,
            },
        };
    }
    async updatePayment(input) {
        const currencyOverride = await this.resolveCurrencyOverride();
        const currencyCode = (0, currencies_1.normalizeCurrencyCode)(input.currency_code || currencyOverride || "EUR");
        (0, currencies_1.assertPayPalCurrencySupported)({
            currencyCode,
            paypalCurrencyOverride: currencyOverride,
        });
        return {
            data: {
                ...(input.data || {}),
                ...this.invalidateStaleOrder(input, currencyCode),
                amount: input.amount,
                currency_code: currencyCode,
            },
        };
    }
    async authorizePayment(_input) {
        const { data } = await this.normalizePaymentData(_input);
        const requestId = this.getIdempotencyKey(_input, "authorize");
        const { advancedCardSettings } = await this.resolveSettings();
        const disabledCards = Array.isArray(advancedCardSettings.disabledCards)
            ? advancedCardSettings.disabledCards.map((card) => String(card).toLowerCase())
            : [];
        const cardBrand = String(data.card_brand || data.cardBrand || data?.paypal?.card_brand || "").toLowerCase();
        if (cardBrand && disabledCards.includes(cardBrand)) {
            throw new Error(`Card brand ${cardBrand} is disabled by admin settings.`);
        }
        const existingPayPal = (data.paypal || {});
        // Session already carries a settled capture: trust it without a network
        // round-trip, but only when the stored capture is actually COMPLETED — a
        // PENDING/DECLINED capture must never be booked as captured money.
        const storedCaptureStatus = (0, status_utils_1.extractCaptureStatus)(existingPayPal.capture);
        if (storedCaptureStatus === "COMPLETED") {
            return {
                status: "captured",
                data: {
                    ...(_input.data || {}),
                    captured_at: data.captured_at || new Date().toISOString(),
                },
            };
        }
        const orderId = String(existingPayPal.order_id || data.order_id || "");
        if (!orderId) {
            // Nothing to authorize: a PayPal order only exists after the buyer
            // submitted their card via the storefront (create-order + card fields).
            // The previous fallback created a fresh order here and immediately
            // called /authorize on it, which PayPal always rejects (no payment
            // source, and 422 UNSUPPORTED_INTENT for CAPTURE-intent orders).
            throw new utils_1.MedusaError(utils_1.MedusaError.Types.NOT_ALLOWED, "No PayPal order was found for this payment session. The buyer must submit and approve their card payment before the cart can be completed.");
        }
        let order = null;
        try {
            order = (await this.getOrderDetails(orderId));
        }
        catch (e) {
            console.warn("[PayPal] card authorizePayment: order lookup failed:", e?.message);
            // Fall back to the session's own record on a transient lookup failure so
            // checkout isn't blocked when a real authorization/capture exists.
            if (data.captured_at) {
                return {
                    status: "captured",
                    data: { ...(_input.data || {}), captured_at: data.captured_at },
                };
            }
            if (existingPayPal.capture_id ||
                existingPayPal.authorization_id ||
                data.authorized_at) {
                return {
                    status: "authorized",
                    data: {
                        ...(_input.data || {}),
                        authorized_at: data.authorized_at || new Date().toISOString(),
                    },
                };
            }
            throw e;
        }
        if (!order) {
            throw new Error("Unable to resolve PayPal order details for authorization.");
        }
        const capture = order?.purchase_units?.[0]?.payments?.captures?.[0];
        const authorization = order?.purchase_units?.[0]?.payments?.authorizations?.[0];
        // Derive the status from what actually happened at PayPal, never from the
        // mere presence of a capture/authorization or from the configured
        // paymentAction: a PENDING (eCheck) capture is not settled money and a
        // DENIED/DECLINED one must fail the authorization.
        if (capture?.id) {
            const captureStatus = this.mapCaptureStatus(capture?.status);
            if (captureStatus === "captured") {
                return {
                    status: "captured",
                    data: {
                        ...(data || {}),
                        paypal: {
                            ...existingPayPal,
                            order_id: orderId,
                            order,
                            capture_id: capture.id,
                            capture,
                        },
                        captured_at: new Date().toISOString(),
                    },
                };
            }
            if (captureStatus === "pending") {
                return {
                    status: "authorized",
                    data: {
                        ...(data || {}),
                        paypal: {
                            ...existingPayPal,
                            order_id: orderId,
                            order,
                            capture_id: capture.id,
                        },
                        authorized_at: new Date().toISOString(),
                    },
                };
            }
            if (captureStatus === "error" || captureStatus === "canceled") {
                return {
                    status: "error",
                    data: {
                        ...(data || {}),
                        paypal: { ...existingPayPal, order_id: orderId, order },
                    },
                };
            }
        }
        if (authorization?.id) {
            const authStatus = this.mapAuthorizationStatus(authorization?.status);
            if (authStatus === "authorized") {
                return {
                    status: "authorized",
                    data: {
                        ...(data || {}),
                        paypal: {
                            ...existingPayPal,
                            order_id: orderId,
                            order,
                            authorization_id: authorization.id,
                            authorizations: order?.purchase_units?.[0]?.payments?.authorizations || [],
                        },
                        authorized_at: new Date().toISOString(),
                    },
                };
            }
            if (authStatus === "error" || authStatus === "canceled") {
                return {
                    status: "error",
                    data: {
                        ...(data || {}),
                        paypal: { ...existingPayPal, order_id: orderId, order },
                    },
                };
            }
        }
        const orderStatus = String(order?.status || "").toUpperCase();
        const orderIntent = String(order?.intent || "").toUpperCase();
        if (orderStatus === "APPROVED") {
            if (orderIntent === "AUTHORIZE") {
                // Approved AUTHORIZE-intent order with no authorization yet: create it.
                const { accessToken, base } = await this.getPayPalAccessToken();
                const authorizeResp = await (0, paypal_fetch_1.paypalFetch)(`${base}/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "Content-Type": "application/json",
                        "PayPal-Request-Id": `${requestId}-auth`,
                        "PayPal-Partner-Attribution-Id": partner_1.PAYPAL_PARTNER_ATTRIBUTION_ID,
                    },
                });
                const authorizeText = await authorizeResp.text();
                const authorizeDebugId = authorizeResp.headers.get("paypal-debug-id");
                if (!authorizeResp.ok) {
                    throw new Error(`PayPal authorize order error (${authorizeResp.status}): ${authorizeText}${authorizeDebugId ? ` debug_id=${authorizeDebugId}` : ""}`);
                }
                const authorized = JSON.parse(authorizeText);
                const authorizationId = authorized?.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
                return {
                    status: "authorized",
                    data: {
                        ...(data || {}),
                        paypal: {
                            ...existingPayPal,
                            order_id: orderId,
                            order: authorized || order,
                            authorization_id: authorizationId,
                            authorizations: authorized?.purchase_units?.[0]?.payments?.authorizations || [],
                        },
                        authorized_at: new Date().toISOString(),
                    },
                };
            }
            // Approved CAPTURE-intent order: the buyer approved but the capture has
            // not happened yet (e.g. the storefront capture call failed). Report
            // "authorized" so the order can complete; capturePayment then routes the
            // actual capture by intent. Calling /authorize here — as the previous
            // code did for every intent — always fails with 422 UNSUPPORTED_INTENT
            // and permanently stuck the checkout.
            return {
                status: "authorized",
                data: {
                    ...(data || {}),
                    paypal: {
                        ...existingPayPal,
                        order_id: orderId,
                        order,
                    },
                    authorized_at: new Date().toISOString(),
                },
            };
        }
        // CREATED / SAVED / PAYER_ACTION_REQUIRED etc.: the buyer never approved
        // the payment — nothing is authorized at PayPal.
        throw new utils_1.MedusaError(utils_1.MedusaError.Types.NOT_ALLOWED, `PayPal order ${orderId} has not been approved by the buyer (status ${orderStatus || "UNKNOWN"}). The payment cannot be authorized.`);
    }
    async capturePayment(_input) {
        const data = (_input.data || {});
        const paypalData = (data.paypal || {});
        const orderId = String(paypalData.order_id || data.order_id || "");
        let authorizationId = String(paypalData.authorization_id || data.authorization_id || "");
        if (!orderId) {
            throw new Error("PayPal order_id is required to capture payment");
        }
        if (paypalData.capture_id || paypalData.capture) {
            return {
                data: {
                    ...(data || {}),
                    paypal: {
                        ...paypalData,
                        capture_id: paypalData.capture_id,
                        capture: paypalData.capture,
                    },
                    captured_at: new Date().toISOString(),
                },
            };
        }
        const { amount: sessionAmount, currencyCode } = await this.normalizePaymentData(_input);
        // The requested (possibly partial) capture amount lives on the Medusa
        // capture row, not in the provider input — resolve it so partial captures
        // don't charge the full session total.
        const amount = await this.resolveRequestedCaptureAmount(_input, sessionAmount);
        // Include the amount in the idempotency suffix: PayPal deduplicates by
        // PayPal-Request-Id, so two sequential partial captures of the same order
        // that share an upstream idempotency_key would otherwise collide and the
        // second capture would silently return the first one's result.
        const requestId = this.getIdempotencyKey(_input, `capture-${orderId}-${amount}`);
        let debugId = null;
        const { accessToken, base } = await this.getPayPalAccessToken();
        const order = await this.getOrderDetails(orderId).catch(() => null);
        const existingCapture = order?.purchase_units?.[0]?.payments?.captures?.[0];
        if (existingCapture?.id && (0, status_utils_1.isCaptureCompleted)(existingCapture)) {
            return {
                data: {
                    ...(data || {}),
                    paypal: {
                        ...paypalData,
                        capture_id: existingCapture.id,
                        capture: existingCapture,
                    },
                    captured_at: new Date().toISOString(),
                },
            };
        }
        const resolvedIntent = String(order?.intent || paypalData.order?.intent || data.intent || "").toUpperCase();
        if (!authorizationId && resolvedIntent === "AUTHORIZE") {
            const authorizeResp = await (0, paypal_fetch_1.paypalFetch)(`${base}/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                    "PayPal-Request-Id": `${requestId}-auth`,
                    "PayPal-Partner-Attribution-Id": partner_1.PAYPAL_PARTNER_ATTRIBUTION_ID,
                },
            });
            const authorizeText = await authorizeResp.text();
            debugId = authorizeResp.headers.get("paypal-debug-id");
            if (!authorizeResp.ok) {
                throw new Error(`PayPal authorize order error (${authorizeResp.status}): ${authorizeText}${debugId ? ` debug_id=${debugId}` : ""}`);
            }
            const authorization = JSON.parse(authorizeText);
            authorizationId =
                authorization?.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
        }
        const isFinalCapture = paypalData.is_final_capture ??
            data.is_final_capture ??
            data.final_capture ??
            undefined;
        const captureValue = amount > 0
            ? (0, amounts_1.formatAmountForPayPal)(amount, currencyCode || "EUR")
            : null;
        // `amount` and `is_final_capture` are only honored on the authorizations
        // capture endpoint. The orders capture endpoint always captures the FULL
        // order and silently ignores an `amount` body — so a partial amount there
        // would over-capture while we record the smaller requested value. Route
        // partial captures through the authorization, and fail closed if a partial
        // capture is attempted against a capture-intent order.
        let capturePayload;
        let captureUrl;
        if (authorizationId) {
            captureUrl = `${base}/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`;
            capturePayload = {
                ...(captureValue
                    ? { amount: { currency_code: currencyCode || "EUR", value: captureValue } }
                    : {}),
                ...(typeof isFinalCapture === "boolean" ? { is_final_capture: isFinalCapture } : {}),
            };
        }
        else {
            captureUrl = `${base}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`;
            capturePayload = {};
            const orderTotal = order?.purchase_units?.[0]?.amount?.value;
            if (captureValue && orderTotal && captureValue !== String(orderTotal)) {
                throw new Error(`PayPal partial capture (${captureValue} ${currencyCode || "EUR"}) is not supported for ` +
                    `capture-intent orders (order total ${orderTotal}). Create the order with intent ` +
                    `AUTHORIZE to capture a partial amount.`);
            }
        }
        // Retry transient 5xx/429/timeout: the PayPal-Request-Id makes the capture
        // idempotent, so a retry after a network blip re-uses the same capture
        // instead of double-charging.
        const ppResp = await (0, paypal_fetch_1.paypalFetchWithRetry)(captureUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "PayPal-Request-Id": requestId,
                "PayPal-Partner-Attribution-Id": partner_1.PAYPAL_PARTNER_ATTRIBUTION_ID,
            },
            body: JSON.stringify(capturePayload),
        });
        const ppText = await ppResp.text();
        debugId = ppResp.headers.get("paypal-debug-id");
        if (!ppResp.ok) {
            throw new Error(`PayPal capture error (${ppResp.status}): ${ppText}${debugId ? ` debug_id=${debugId}` : ""}`);
        }
        const capture = JSON.parse(ppText);
        // A 2xx response does NOT mean the funds were captured. PayPal returns 201
        // for captures that are PENDING (pending review / eCheck), DECLINED, or
        // FAILED. Recording any of these as "captured" books money that never
        // settled, so only a COMPLETED capture is treated as success.
        const captureStatus = (0, status_utils_1.extractCaptureStatus)(capture);
        if (captureStatus !== "COMPLETED") {
            throw new Error(`PayPal capture did not complete (status=${captureStatus || "UNKNOWN"}). ` +
                `The payment was not captured.${debugId ? ` debug_id=${debugId}` : ""}`);
        }
        const captureId = capture?.id || capture?.purchase_units?.[0]?.payments?.captures?.[0]?.id;
        const existingCaptures = Array.isArray(paypalData.captures) ? paypalData.captures : [];
        const captureEntry = {
            id: captureId,
            status: capture?.status,
            amount: capture?.amount,
            raw: capture,
        };
        return {
            data: {
                ...(data || {}),
                paypal: {
                    ...paypalData,
                    order_id: orderId,
                    capture_id: captureId,
                    capture,
                    authorization_id: authorizationId || paypalData.authorization_id,
                    captures: [...existingCaptures, captureEntry],
                },
                captured_at: new Date().toISOString(),
            },
        };
    }
    async cancelPayment(_input) {
        const data = (_input.data || {});
        const paypalData = (data.paypal || {});
        const orderId = String(paypalData.order_id || data.order_id || "");
        const captureId = String(paypalData.capture_id || data.capture_id || "");
        const storedAuthorizationId = String(paypalData.authorization_id || data.authorization_id || "");
        const order = orderId ? await this.getOrderDetails(orderId) : null;
        const intent = String(order?.intent || "").toUpperCase();
        const authorizationId = order?.purchase_units?.[0]?.payments?.authorizations?.[0]?.id ||
            storedAuthorizationId;
        if (intent === "AUTHORIZE" && authorizationId) {
            const { accessToken, base } = await this.getPayPalAccessToken();
            const requestId = this.getIdempotencyKey(_input, `void-${authorizationId}`);
            const resp = await (0, paypal_fetch_1.paypalFetch)(`${base}/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                    "PayPal-Request-Id": requestId,
                    "PayPal-Partner-Attribution-Id": partner_1.PAYPAL_PARTNER_ATTRIBUTION_ID,
                },
            });
            if (!resp.ok) {
                const text = await resp.text();
                const debugId = resp.headers.get("paypal-debug-id");
                throw new Error(`PayPal void error (${resp.status}): ${text}${debugId ? ` debug_id=${debugId}` : ""}`);
            }
        }
        else if (captureId) {
            const { accessToken, base } = await this.getPayPalAccessToken();
            const requestId = this.getIdempotencyKey(_input, `cancel-refund-${captureId}`);
            const resp = await (0, paypal_fetch_1.paypalFetch)(`${base}/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                    "PayPal-Request-Id": requestId,
                    "PayPal-Partner-Attribution-Id": partner_1.PAYPAL_PARTNER_ATTRIBUTION_ID,
                },
                body: JSON.stringify({}),
            });
            if (!resp.ok) {
                const text = await resp.text();
                const debugId = resp.headers.get("paypal-debug-id");
                throw new Error(`PayPal refund error (${resp.status}): ${text}${debugId ? ` debug_id=${debugId}` : ""}`);
            }
            const refund = await resp.json().catch(() => ({}));
            const existingRefunds = Array.isArray(paypalData.refunds) ? paypalData.refunds : [];
            const refundEntry = {
                id: refund?.id,
                status: refund?.status,
                amount: refund?.amount,
                raw: refund,
            };
            return {
                data: {
                    ...(data || {}),
                    paypal: {
                        ...paypalData,
                        order: order || undefined,
                        authorization_id: authorizationId || storedAuthorizationId,
                        capture_id: captureId || paypalData.capture_id,
                        refund_id: refund?.id,
                        refund_status: refund?.status,
                        refunds: [...existingRefunds, refundEntry],
                    },
                    canceled_at: new Date().toISOString(),
                },
            };
        }
        return {
            data: {
                ...(data || {}),
                paypal: {
                    ...paypalData,
                    order: order || undefined,
                    authorization_id: authorizationId || storedAuthorizationId,
                    capture_id: captureId || paypalData.capture_id,
                },
                canceled_at: new Date().toISOString(),
            },
        };
    }
    async refundPayment(_input) {
        const data = (_input.data || {});
        const paypalData = (data.paypal || {});
        const captureId = String(paypalData.capture_id || data.capture_id || "");
        if (!captureId) {
            throw new utils_1.MedusaError(utils_1.MedusaError.Types.INVALID_DATA, "PayPal capture_id is required to refund payment. No capture found in session data.");
        }
        // Use the refund amount Medusa passes (top-level input), not the session
        // amount in `data` — otherwise a partial refund would refund the full order.
        // Medusa passes it as a BigNumberInput, so coerce it to a number; a naive
        // Number() of the object form yields NaN and silently refunds the full
        // capture.
        const amount = (0, amounts_1.toAmountNumber)(_input.amount);
        const requestId = this.getIdempotencyKey(_input, `refund-${captureId}-${amount}`);
        const currencyOverride = await this.resolveCurrencyOverride();
        const currencyCode = (0, currencies_1.normalizeCurrencyCode)(data.currency_code || currencyOverride || "EUR");
        try {
            const { accessToken, base } = await this.getPayPalAccessToken();
            const refundPayload = amount > 0
                ? {
                    amount: {
                        currency_code: currencyCode,
                        value: (0, amounts_1.formatAmountForPayPal)(amount, currencyCode),
                    },
                }
                : {};
            // Retry transient 5xx/429/timeout: the PayPal-Request-Id (which includes
            // the refund amount) makes the refund idempotent, so a retry after a
            // network blip re-uses the same refund instead of double-refunding.
            const resp = await (0, paypal_fetch_1.paypalFetchWithRetry)(`${base}/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                    "PayPal-Request-Id": requestId,
                    "PayPal-Partner-Attribution-Id": partner_1.PAYPAL_PARTNER_ATTRIBUTION_ID,
                },
                body: JSON.stringify(refundPayload),
            });
            const text = await resp.text();
            if (!resp.ok) {
                const debugId = resp.headers.get("paypal-debug-id");
                throw new utils_1.MedusaError(utils_1.MedusaError.Types.UNEXPECTED_STATE, `PayPal refund error (${resp.status}): ${text}${debugId ? ` debug_id=${debugId}` : ""}`);
            }
            const refund = JSON.parse(text);
            // As with captures, a 2xx response does not guarantee the refund stuck.
            // FAILED / CANCELLED / DENIED refunds also return 2xx and must not be
            // recorded as a successful refund. PENDING is accepted: PayPal processes
            // refunds asynchronously and a pending refund will settle.
            const refundStatus = String(refund?.status || "").toUpperCase();
            if ((0, status_utils_1.isRefundFailureStatus)(refundStatus)) {
                const refundDebugId = resp.headers.get("paypal-debug-id");
                throw new utils_1.MedusaError(utils_1.MedusaError.Types.UNEXPECTED_STATE, `PayPal refund did not succeed (status=${refundStatus}). The refund was not issued.` +
                    (refundDebugId ? ` debug_id=${refundDebugId}` : ""));
            }
            const existingRefunds = Array.isArray(paypalData.refunds) ? paypalData.refunds : [];
            const refundEntry = {
                id: refund?.id,
                status: refund?.status,
                amount: refund?.amount,
                raw: refund,
            };
            return {
                data: {
                    ...(data || {}),
                    paypal: {
                        ...paypalData,
                        refund_id: refund?.id,
                        refund_status: refund?.status,
                        refunds: [...existingRefunds, refundEntry],
                        refund,
                    },
                    refunded_at: new Date().toISOString(),
                },
            };
        }
        catch (error) {
            // Surface the real reason: Medusa masks any non-MedusaError as a generic
            // "An unknown error occurred." in production, hiding the PayPal failure.
            throw error instanceof utils_1.MedusaError
                ? error
                : new utils_1.MedusaError(utils_1.MedusaError.Types.UNEXPECTED_STATE, error?.message || "PayPal refund failed.");
        }
    }
    async retrievePayment(_input) {
        const data = (_input.data || {});
        const paypalData = (data.paypal || {});
        const orderId = String(paypalData.order_id || data.order_id || "");
        if (!orderId) {
            return { data: { ...(data || {}) } };
        }
        const order = await this.getOrderDetails(orderId);
        const capture = order?.purchase_units?.[0]?.payments?.captures?.[0];
        const authorization = order?.purchase_units?.[0]?.payments?.authorizations?.[0];
        return {
            data: {
                ...(data || {}),
                paypal: {
                    ...paypalData,
                    order,
                    authorization_id: authorization?.id || paypalData.authorization_id,
                    capture_id: capture?.id || paypalData.capture_id,
                },
            },
        };
    }
    async getPaymentStatus(_input) {
        const data = (_input.data || {});
        const paypalData = (data.paypal || {});
        const orderId = String(paypalData.order_id || data.order_id || "");
        if (!orderId) {
            return { status: "pending", data: { ...(data || {}) } };
        }
        const order = await this.getOrderDetails(orderId);
        const capture = order?.purchase_units?.[0]?.payments?.captures?.[0];
        const authorization = order?.purchase_units?.[0]?.payments?.authorizations?.[0];
        const mappedStatus = this.mapCaptureStatus(capture?.status) ||
            this.mapAuthorizationStatus(authorization?.status) ||
            this.mapOrderStatus(order?.status) ||
            "pending";
        return {
            status: mappedStatus,
            data: {
                ...(data || {}),
                paypal: {
                    ...paypalData,
                    order,
                    authorization_id: authorization?.id || paypalData.authorization_id,
                    capture_id: capture?.id || paypalData.capture_id,
                },
            },
        };
    }
}
exports.PayPalAdvancedCardProvider = PayPalAdvancedCardProvider;
exports.default = PayPalAdvancedCardProvider;
//# sourceMappingURL=card-service.js.map