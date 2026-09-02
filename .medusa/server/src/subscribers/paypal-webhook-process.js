"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = exports.PAYPAL_WEBHOOK_RECEIVED_EVENT = void 0;
exports.default = paypalWebhookProcessHandler;
const webhook_processor_1 = require("../modules/paypal/webhook-processor");
exports.PAYPAL_WEBHOOK_RECEIVED_EVENT = "paypal.webhook.received";
/**
 * Asynchronous PayPal webhook processing.
 *
 * The webhook route verifies the signature, persists the event (status
 * "processing"), emits `paypal.webhook.received`, and returns 200 immediately —
 * so PayPal's ~15s delivery timeout can't be tripped by slow downstream work and
 * the event is never lost. This subscriber does the actual processing off the
 * request path, using its own framework-managed container (no request-scope
 * disposal risk). If the event bus ever drops the message, the webhook retry
 * cron recovers events left in "processing" past a staleness threshold, so
 * delivery is guaranteed either way.
 */
async function paypalWebhookProcessHandler({ event, container, }) {
    const recordId = event?.data?.id;
    if (!recordId)
        return;
    const paypal = container.resolve("paypal_onboarding");
    let record;
    try {
        const rows = await paypal.listPayPalWebhookEvents({ id: [recordId] }, { take: 1 });
        record = rows?.[0];
    }
    catch (e) {
        console.error("[PayPal] webhook subscriber: failed to load event", {
            id: recordId,
            error: e?.message,
        });
        return;
    }
    if (!record) {
        console.warn("[PayPal] webhook subscriber: event not found", { id: recordId });
        return;
    }
    // Only process events still queued for the first attempt. Anything already
    // processed/failed/ignored/dead-lettered is owned by the retry cron; skipping
    // here keeps the subscriber idempotent if the bus delivers more than once.
    if (String(record.status) !== "processing") {
        return;
    }
    const eventType = String(record.event_type || "");
    if (!(0, webhook_processor_1.isAllowedEventType)(eventType)) {
        await paypal
            .updateWebhookEventRecord({ id: recordId, status: "ignored", processed_at: new Date() })
            .catch(() => { });
        return;
    }
    try {
        const payload = (record.payload || {});
        const processed = await (0, webhook_processor_1.processPayPalWebhookEvent)(container, { eventType, payload });
        await paypal
            .updateWebhookEventRecord({
            id: recordId,
            status: "processed",
            processed_at: new Date(),
            resource_id: processed.refundId || processed.captureId || processed.orderId || null,
        })
            .catch(() => { });
        console.info("[PayPal] webhook: processed (async)", {
            id: recordId,
            event_type: eventType,
            order_id: processed.orderId,
            capture_id: processed.captureId,
            refund_id: processed.refundId,
            cart_id: processed.cartId,
            session_updated: processed.sessionUpdated,
            cart_completed: processed.cartCompleted,
        });
        if (processed.cartCompleted) {
            await paypal.recordMetric("webhook_cart_completed").catch(() => { });
        }
        await paypal.recordMetric("webhook_success").catch(() => { });
    }
    catch (e) {
        const retryable = (0, webhook_processor_1.isRetryableError)(e);
        const nextStatus = retryable ? "failed" : "dead_letter";
        await paypal
            .updateWebhookEventRecord({
            id: recordId,
            status: nextStatus,
            attempt_count: 1,
            next_retry_at: retryable ? (0, webhook_processor_1.computeNextRetryAt)(1) : null,
            last_error: e?.message || String(e),
        })
            .catch(() => { });
        await paypal
            .recordAuditEvent("webhook_processing_failed", {
            event_id: record.event_id,
            event_type: eventType,
            retryable,
            message: e?.message || String(e),
        })
            .catch(() => { });
        await paypal.recordMetric("webhook_failed").catch(() => { });
        console.error("[PayPal] webhook: processing failed (async)", {
            id: recordId,
            event_type: eventType,
            retryable,
            error: e?.message,
        });
    }
}
exports.config = {
    event: exports.PAYPAL_WEBHOOK_RECEIVED_EVENT,
};
//# sourceMappingURL=paypal-webhook-process.js.map