import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
export declare const PAYPAL_WEBHOOK_RECEIVED_EVENT = "paypal.webhook.received";
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
export default function paypalWebhookProcessHandler({ event, container, }: SubscriberArgs<{
    id: string;
}>): Promise<void>;
export declare const config: SubscriberConfig;
//# sourceMappingURL=paypal-webhook-process.d.ts.map