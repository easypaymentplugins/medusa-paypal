"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_WEBHOOK_ATTEMPTS = exports.SUPPORTED_EVENT_PREFIXES = exports.EVENT_STATUS_MAP = void 0;
exports.isTransitionAllowed = isTransitionAllowed;
exports.isAllowedEventType = isAllowedEventType;
exports.isRetryableError = isRetryableError;
exports.computeNextRetryAt = computeNextRetryAt;
exports.normalizeResource = normalizeResource;
exports.normalizeEventVersion = normalizeEventVersion;
exports.extractCaptureIdFromLinks = extractCaptureIdFromLinks;
exports.extractIdentifiers = extractIdentifiers;
exports.isPartialRefund = isPartialRefund;
exports.processPayPalWebhookEvent = processPayPalWebhookEvent;
const utils_1 = require("@medusajs/framework/utils");
const provider_ids_1 = require("./utils/provider-ids");
exports.EVENT_STATUS_MAP = {
    "CHECKOUT.ORDER.APPROVED": "authorized",
    "CHECKOUT.ORDER.CANCELLED": "canceled",
    "PAYMENT.CAPTURE.COMPLETED": "captured",
    "PAYMENT.CAPTURE.DENIED": "error",
    "PAYMENT.CAPTURE.PENDING": "authorized",
    "PAYMENT.CAPTURE.REFUNDED": "canceled",
    "PAYMENT.CAPTURE.REVERSED": "canceled",
    "PAYMENT.AUTHORIZATION.CREATED": "authorized",
    "PAYMENT.AUTHORIZATION.VOIDED": "canceled",
    "PAYMENT.AUTHORIZATION.DENIED": "error",
    "PAYMENT.AUTHORIZATION.EXPIRED": "canceled",
    "PAYMENT.REFUND.COMPLETED": "canceled",
    "PAYMENT.REFUND.DENIED": "error",
};
const ALLOWED_TRANSITIONS = {
    pending: new Set(["authorized", "captured", "canceled", "error"]),
    authorized: new Set(["captured", "canceled", "error"]),
    captured: new Set(["canceled"]),
    canceled: new Set([]),
    error: new Set(["authorized", "captured", "canceled"]),
};
function isTransitionAllowed(from, to) {
    return ALLOWED_TRANSITIONS[from]?.has(to) ?? false;
}
exports.SUPPORTED_EVENT_PREFIXES = [
    "PAYMENT.CAPTURE.",
    "CHECKOUT.ORDER.",
    "PAYMENT.AUTHORIZATION.",
    "PAYMENT.REFUND.",
];
function isAllowedEventType(eventType) {
    return exports.SUPPORTED_EVENT_PREFIXES.some((prefix) => eventType.startsWith(prefix));
}
const NON_RETRYABLE_PATTERNS = [
    "payment collection not found",
    "no paypal session",
    "session not found",
    "cart not found",
    "no payment collection",
];
function isRetryableError(error) {
    const message = String(error instanceof Error ? error.message : error ?? "").toLowerCase();
    return !NON_RETRYABLE_PATTERNS.some((p) => message.includes(p));
}
const RETRY_SCHEDULE_MINUTES = [2, 10, 30, 60, 120];
exports.MAX_WEBHOOK_ATTEMPTS = RETRY_SCHEDULE_MINUTES.length + 1;
function computeNextRetryAt(attemptCount) {
    const idx = attemptCount - 1;
    const delayMinutes = RETRY_SCHEDULE_MINUTES[idx];
    if (delayMinutes === undefined || attemptCount <= 0)
        return null;
    return new Date(Date.now() + delayMinutes * 60 * 1000);
}
function normalizeResource(payload) {
    const resource = payload?.resource;
    if (!resource)
        return {};
    if (typeof resource === "string") {
        try {
            return JSON.parse(resource);
        }
        catch {
            return {};
        }
    }
    return resource;
}
function normalizeEventVersion(payload) {
    const raw = payload?.event_version ??
        payload?.resource_version ??
        payload?.resource?.resource_version ??
        payload?.resource?.version ??
        null;
    if (!raw)
        return null;
    return String(raw).trim().replace(/^v/i, "");
}
/** Pull the capture id out of a refund resource's "up" HATEOAS link. */
function extractCaptureIdFromLinks(resource) {
    const links = Array.isArray(resource?.links) ? resource.links : [];
    for (const link of links) {
        const href = String(link?.href || "");
        const match = href.match(/\/captures\/([A-Za-z0-9-]+)/);
        if (match)
            return match[1];
    }
    return null;
}
function extractIdentifiers(resource, eventType) {
    const related = resource?.supplementary_data?.related_ids || {};
    const isOrder = eventType.startsWith("CHECKOUT.ORDER.");
    const isCapture = eventType.startsWith("PAYMENT.CAPTURE.");
    const isAuthorization = eventType.startsWith("PAYMENT.AUTHORIZATION.");
    const isRefund = eventType.startsWith("PAYMENT.REFUND.");
    let orderId = null;
    let captureId = null;
    let refundId = null;
    let cartId = null;
    if (isOrder) {
        orderId = String(resource?.id || "").trim() || null;
        cartId =
            String(resource?.purchase_units?.[0]?.custom_id || resource?.custom_id || "").trim() || null;
        captureId =
            String(resource?.purchase_units?.[0]?.payments?.captures?.[0]?.id || "").trim() || null;
    }
    else if (isCapture) {
        // PAYMENT.CAPTURE.REFUNDED / REVERSED carry a *refund* resource (its `id`
        // is the refund id, with an "up" link to the capture) — treating that id
        // as the capture id would corrupt the session's stored capture_id.
        const isRefundShaped = eventType === "PAYMENT.CAPTURE.REFUNDED" ||
            eventType === "PAYMENT.CAPTURE.REVERSED";
        if (isRefundShaped) {
            refundId = String(resource?.id || "").trim() || null;
            captureId =
                String(related?.capture_id || "").trim() ||
                    extractCaptureIdFromLinks(resource) ||
                    null;
        }
        else {
            captureId = String(resource?.id || "").trim() || null;
        }
        orderId = String(related?.order_id || "").trim() || null;
        cartId = String(resource?.custom_id || "").trim() || null;
    }
    else if (isAuthorization) {
        orderId = String(related?.order_id || "").trim() || null;
        cartId = String(resource?.custom_id || "").trim() || null;
    }
    else if (isRefund) {
        refundId = String(resource?.id || "").trim() || null;
        orderId = String(related?.order_id || "").trim() || null;
        captureId = String(related?.capture_id || "").trim() || null;
        // The refund resource carries the capture's custom_id (the cart id) when it
        // was set on the purchase unit — use it so refunds resolve directly instead
        // of always falling back to a session scan.
        cartId = String(resource?.custom_id || "").trim() || null;
    }
    return { orderId, captureId, refundId, cartId };
}
async function findPayPalSession(container, cartId) {
    const paymentModule = container.resolve(utils_1.Modules.PAYMENT);
    let collections;
    try {
        collections = await paymentModule.listPaymentCollections({ cart_id: [cartId] }, { take: 1 });
    }
    catch (e) {
        throw new Error(`payment collection not found for cart ${cartId}: ${e?.message}`);
    }
    const collection = collections?.[0];
    if (!collection?.id) {
        throw new Error(`payment collection not found for cart ${cartId}`);
    }
    const sessions = await paymentModule.listPaymentSessions({
        payment_collection_id: collection.id,
    }, { take: 50 });
    const paypalSession = (sessions || [])
        .filter((s) => (0, provider_ids_1.isPayPalProviderId)(s.provider_id))
        .sort((a, b) => new Date(b.created_at || 0).getTime() -
        new Date(a.created_at || 0).getTime())[0];
    if (!paypalSession) {
        throw new Error(`no paypal session found in collection ${collection.id} for cart ${cartId}`);
    }
    return {
        sessionId: paypalSession.id,
        sessionData: (paypalSession.data || {}),
        sessionStatus: String(paypalSession.status || "pending"),
        collectionId: collection.id,
    };
}
function mergeRefunds(existing, incoming) {
    const seen = new Set();
    const merged = [];
    for (const refund of [...existing, ...incoming]) {
        const id = String(refund?.id || "");
        if (id && seen.has(id))
            continue;
        if (id)
            seen.add(id);
        merged.push(refund);
    }
    return merged;
}
async function applyStatusToSession(container, resolved, status, patch) {
    const paymentModule = container.resolve(utils_1.Modules.PAYMENT);
    // A null status means "record the data but keep the current session status"
    // (e.g. a partial refund must not cancel a captured session).
    if (status !== null && !isTransitionAllowed(resolved.sessionStatus, status)) {
        console.info(`[PayPal] webhook: skipping disallowed transition ${resolved.sessionStatus} → ${status} for session ${resolved.sessionId}`);
        return;
    }
    const existingPaypal = (resolved.sessionData.paypal || {});
    const existingRefunds = Array.isArray(existingPaypal.refunds)
        ? existingPaypal.refunds
        : [];
    const incomingRefunds = Array.isArray(patch.refunds)
        ? patch.refunds
        : null;
    const nextRefunds = incomingRefunds
        ? mergeRefunds(existingRefunds, incomingRefunds)
        : existingRefunds;
    // Drop undefined/null values from the patch so a webhook that lacks an
    // identifier (e.g. a capture event with no related_ids) can never clobber
    // stored fields like `order_id` with null.
    const cleanPatch = {};
    for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined && v !== null)
            cleanPatch[k] = v;
    }
    await paymentModule.updatePaymentSession({
        id: resolved.sessionId,
        status: status === null ? resolved.sessionStatus : status,
        data: {
            ...resolved.sessionData,
            paypal: {
                ...existingPaypal,
                ...cleanPatch,
                refunds: nextRefunds,
            },
        },
    });
}
/**
 * True when a refund resource demonstrably covers less than the captured
 * amount. Uses the refund's cumulative `total_refunded_amount` (falling back
 * to the single refund amount) against the capture amount stored on the
 * session (falling back to the session total). Returns false — i.e. treat as
 * a full refund, matching the previous behavior — whenever the amounts can't
 * be determined.
 */
function isPartialRefund(resource, sessionData) {
    const refundedRaw = resource?.seller_payable_breakdown?.total_refunded_amount?.value ??
        resource?.amount?.value;
    const refunded = Number(refundedRaw);
    if (!Number.isFinite(refunded) || refunded <= 0)
        return false;
    const paypal = (sessionData?.paypal || {});
    const capturedRaw = paypal?.capture?.amount?.value ??
        paypal?.capture?.seller_receivable_breakdown?.gross_amount?.value ??
        sessionData?.amount;
    const captured = Number(capturedRaw);
    if (!Number.isFinite(captured) || captured <= 0)
        return false;
    // Tolerance for floating-point noise; amounts are decimal strings from
    // PayPal or the session's stored major-unit amount.
    return refunded + 0.005 < captured;
}
async function processPayPalWebhookEvent(container, input) {
    const resource = normalizeResource(input.payload);
    const { orderId, captureId, refundId, cartId: rawCartId } = extractIdentifiers(resource, input.eventType);
    const refundReason = String(resource?.note_to_payer || resource?.reason || resource?.seller_note || "").trim() || undefined;
    const refundReasonCode = String(resource?.reason_code || resource?.reasonCode || "").trim() ||
        undefined;
    const targetStatus = exports.EVENT_STATUS_MAP[input.eventType];
    if (!targetStatus) {
        return { orderId, captureId, refundId, cartId: rawCartId, sessionUpdated: false };
    }
    let cartId = rawCartId;
    if (!cartId && (orderId || captureId)) {
        try {
            const paymentModule = container.resolve(utils_1.Modules.PAYMENT);
            const PAGE_SIZE = 200;
            const MAX_PAGES = 5;
            let matchedSession = null;
            let totalScanned = 0;
            for (let page = 0; page < MAX_PAGES && !matchedSession; page++) {
                const sessions = await paymentModule.listPaymentSessions({ provider_id: [...provider_ids_1.PAYPAL_PROVIDER_IDS] }, { take: PAGE_SIZE, skip: page * PAGE_SIZE, order: { created_at: "DESC" } });
                if (!sessions || sessions.length === 0)
                    break;
                totalScanned += sessions.length;
                matchedSession =
                    sessions.find((s) => {
                        const pp = (s.data || {}).paypal || {};
                        if (orderId && pp.order_id === orderId)
                            return true;
                        if (captureId && pp.capture_id === captureId)
                            return true;
                        return false;
                    }) || null;
                if (sessions.length < PAGE_SIZE)
                    break;
            }
            if (!matchedSession && totalScanned >= MAX_PAGES * PAGE_SIZE) {
                console.warn(`[PayPal] webhook: cartId fallback scan hit limit (${totalScanned} sessions). ` +
                    `Event ${input.eventType} may be lost. Ensure custom_id is set on PayPal orders.`, { orderId, captureId });
            }
            if (matchedSession?.payment_collection_id) {
                const colls = await paymentModule.listPaymentCollections({ id: [matchedSession.payment_collection_id] }, { take: 1 });
                cartId = String(colls?.[0]?.cart_id || "").trim() || null;
            }
        }
        catch (e) {
            console.warn(`[PayPal] webhook: cartId fallback lookup failed for ${input.eventType}:`, e instanceof Error ? e.message : e);
        }
    }
    let sessionUpdated = false;
    if (cartId) {
        const resolved = await findPayPalSession(container, cartId);
        if (resolved) {
            const refundEntry = refundId
                ? [
                    {
                        id: refundId,
                        status: resource?.status,
                        reason: refundReason,
                        reason_code: refundReasonCode,
                        amount: resource?.amount,
                        raw: resource,
                    },
                ]
                : null;
            // A PARTIAL refund must not cancel the session: PayPal fires
            // PAYMENT.CAPTURE.REFUNDED / PAYMENT.REFUND.COMPLETED for partial
            // refunds too, and flipping a substantially-paid session to "canceled"
            // misrepresents the payment. Record the refund but keep the status
            // unless the cumulative refunded total covers the captured amount (or
            // the amounts can't be determined, preserving the old full-refund
            // behavior).
            let effectiveStatus = targetStatus;
            const isRefundEvent = input.eventType === "PAYMENT.CAPTURE.REFUNDED" ||
                input.eventType === "PAYMENT.CAPTURE.REVERSED" ||
                input.eventType === "PAYMENT.REFUND.COMPLETED";
            if (isRefundEvent && targetStatus === "canceled") {
                if (isPartialRefund(resource, resolved.sessionData)) {
                    effectiveStatus = null;
                }
            }
            await applyStatusToSession(container, resolved, effectiveStatus, {
                order_id: orderId ?? undefined,
                capture_id: captureId ?? resolved.sessionData.paypal?.capture_id ?? undefined,
                refund_id: refundId ?? undefined,
                refund_status: refundId ? resource?.status : undefined,
                refund_reason: refundReason,
                refund_reason_code: refundReasonCode,
                ...(refundEntry ? { refunds: refundEntry } : {}),
                webhook_event_type: input.eventType,
                last_webhook_at: new Date().toISOString(),
            });
            sessionUpdated = true;
        }
    }
    else {
        console.warn(`[PayPal] webhook: could not resolve cartId for event ${input.eventType}`, { orderId, captureId, refundId });
    }
    return { orderId, captureId, refundId, cartId, sessionUpdated };
}
//# sourceMappingURL=webhook-processor.js.map