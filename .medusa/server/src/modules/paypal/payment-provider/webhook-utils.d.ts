import type { ProviderWebhookPayload, WebhookActionResult } from "@medusajs/framework/types";
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
export declare function getPayPalWebhookActionAndData(payload: ProviderWebhookPayload["payload"]): WebhookActionResult;
//# sourceMappingURL=webhook-utils.d.ts.map