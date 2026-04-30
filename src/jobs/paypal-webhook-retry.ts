import type { MedusaContainer } from "@medusajs/framework/types"
import type PayPalModuleService from "../modules/paypal/service"
import {
  computeNextRetryAt,
  isAllowedEventType,
  isRetryableError,
  MAX_WEBHOOK_ATTEMPTS,
  processPayPalWebhookEvent,
} from "../modules/paypal/webhook-processor"

export default async function paypalWebhookRetry(container: MedusaContainer) {
  const paypal = container.resolve<PayPalModuleService>("paypal_onboarding")
  const now = Date.now()

  const candidates = await paypal.listPayPalWebhookEvents({ status: "failed" })
  if (!candidates?.length) return

  console.info(
    `[PayPal] webhook-retry: evaluating ${candidates.length} failed event(s)`
  )

  for (const event of candidates) {
    const nextRetryAt = event?.next_retry_at
      ? new Date(event.next_retry_at).getTime()
      : null
    if (!nextRetryAt || nextRetryAt > now) continue

    const attemptCount = Number(event.attempt_count || 0)

    if (attemptCount >= MAX_WEBHOOK_ATTEMPTS) {
      await paypal
        .updateWebhookEventRecord({
          id: event.id,
          status: "dead_letter",
          next_retry_at: null,
          last_error: `Exceeded max attempts (${MAX_WEBHOOK_ATTEMPTS})`,
        })
        .catch(() => {})
      console.warn("[PayPal] webhook-retry: dead-lettered (max attempts)", {
        id: event.id,
        event_type: event.event_type,
        attempts: attemptCount,
      })
      await paypal.recordMetric("webhook_dead_letter").catch(() => {})
      continue
    }

    await paypal
      .updateWebhookEventRecord({
        id: event.id,
        status: "processing",
        attempt_count: attemptCount + 1,
        next_retry_at: null,
        last_error: null,
      })
      .catch(() => {})

    const eventType = String(event.event_type || "")

    if (!isAllowedEventType(eventType)) {
      await paypal
        .updateWebhookEventRecord({
          id: event.id,
          status: "ignored",
          processed_at: new Date(),
        })
        .catch(() => {})
      console.info("[PayPal] webhook-retry: ignored unsupported event type", {
        id: event.id,
        event_type: eventType,
      })
      continue
    }

    try {
      const payload = (event.payload || {}) as Record<string, any>
      const processed = await processPayPalWebhookEvent(container, { eventType, payload })

      await paypal
        .updateWebhookEventRecord({
          id: event.id,
          status: "processed",
          processed_at: new Date(),
          resource_id:
            processed.refundId || processed.captureId || processed.orderId || null,
        })
        .catch(() => {})

      console.info("[PayPal] webhook-retry: processed successfully", {
        id: event.id,
        event_type: eventType,
        attempt: attemptCount + 1,
        order_id: processed.orderId,
        capture_id: processed.captureId,
        cart_id: processed.cartId,
        session_updated: processed.sessionUpdated,
      })

      await paypal.recordMetric("webhook_retry_success").catch(() => {})
    } catch (error: any) {
      const retryable = isRetryableError(error)
      const nextAttempt = attemptCount + 1

      if (!retryable || nextAttempt >= MAX_WEBHOOK_ATTEMPTS) {
        await paypal
          .updateWebhookEventRecord({
            id: event.id,
            status: "dead_letter",
            attempt_count: nextAttempt,
            next_retry_at: null,
            last_error: error?.message || String(error),
          })
          .catch(() => {})
        console.error("[PayPal] webhook-retry: dead-lettered after error", {
          id: event.id,
          event_type: eventType,
          attempt: nextAttempt,
          retryable,
          error: error?.message,
        })
        await paypal.recordMetric("webhook_dead_letter").catch(() => {})
      } else {
        const nextRetry = computeNextRetryAt(nextAttempt)
        await paypal
          .updateWebhookEventRecord({
            id: event.id,
            status: "failed",
            attempt_count: nextAttempt,
            next_retry_at: nextRetry,
            last_error: error?.message || String(error),
          })
          .catch(() => {})
        console.warn("[PayPal] webhook-retry: scheduled retry", {
          id: event.id,
          event_type: eventType,
          attempt: nextAttempt,
          next_retry_at: nextRetry?.toISOString(),
          error: error?.message,
        })
        await paypal.recordMetric("webhook_retry_failed").catch(() => {})
      }
    }
  }
}

export const config = {
  name: "paypal-webhook-retry",
  schedule: "*/10 * * * *",
}
