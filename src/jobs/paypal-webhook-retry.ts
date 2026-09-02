import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type PayPalModuleService from "../modules/paypal/service"
import {
  computeNextRetryAt,
  isAllowedEventType,
  isRetryableError,
  MAX_WEBHOOK_ATTEMPTS,
  processPayPalWebhookEvent,
} from "../modules/paypal/webhook-processor"

// Bound how many failed events one run drains so the cron can't load an
// unbounded backlog into memory.
const RETRY_BATCH_SIZE = 100

// Events are persisted as "processing" and handed to the async subscriber. If
// the subscriber never runs (bus dropped the message, process restarted
// mid-flight), the event would otherwise sit in "processing" forever. Recover
// any left in "processing" past this age so async delivery is guaranteed.
const STALE_PROCESSING_MS = (() => {
  const v = Number(process.env.PAYPAL_WEBHOOK_STALE_PROCESSING_MS)
  return Number.isFinite(v) && v > 0 ? v : 5 * 60 * 1000
})()

// Stable key for the Postgres advisory lock that serializes this cron across
// instances. pg_try_advisory_xact_lock auto-releases at transaction end, so
// there is no unlock to pair (and no risk of a leaked lock).
const RETRY_ADVISORY_LOCK_KEY = 838907812

export default async function paypalWebhookRetry(container: MedusaContainer) {
  // Run the sweep under a Postgres advisory lock so that with multiple server
  // instances running this cron, only one drains the queue per cycle (each
  // event is processed at most once). Falls back to running directly if the
  // raw connection isn't resolvable, so the job degrades gracefully rather
  // than breaking.
  let pg: any = null
  try {
    pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  } catch {
    pg = null
  }

  if (!pg?.transaction) {
    await runRetrySweep(container)
    return
  }

  try {
    await pg.transaction(async (trx: any) => {
      const res = await trx.raw(
        "SELECT pg_try_advisory_xact_lock(?) AS locked",
        [RETRY_ADVISORY_LOCK_KEY]
      )
      const locked = res?.rows?.[0]?.locked ?? res?.[0]?.locked ?? false
      if (!locked) {
        console.info("[PayPal] webhook-retry: another instance holds the lock, skipping")
        return
      }
      await runRetrySweep(container)
    })
  } catch (e: any) {
    console.warn("[PayPal] webhook-retry: advisory lock path failed, running unlocked:", e?.message)
    await runRetrySweep(container)
  }
}

async function runRetrySweep(container: MedusaContainer) {
  const paypal = container.resolve<PayPalModuleService>("paypal_onboarding")
  const now = Date.now()

  // 1. Failed events whose backoff has elapsed.
  const failed = await paypal.listPayPalWebhookEvents(
    { status: "failed" },
    { take: RETRY_BATCH_SIZE, order: { next_retry_at: "ASC" } }
  )
  const dueFailed = (failed || []).filter((event: any) => {
    const nextRetryAt = event?.next_retry_at
      ? new Date(event.next_retry_at).getTime()
      : null
    return nextRetryAt !== null && nextRetryAt <= now
  })

  // 2. Events stuck in "processing" past the staleness threshold — the async
  // subscriber never finished them (dropped bus message / restart), so recover.
  const processing = await paypal.listPayPalWebhookEvents(
    { status: "processing" },
    { take: RETRY_BATCH_SIZE, order: { updated_at: "ASC" } }
  )
  const staleProcessing = (processing || []).filter((event: any) => {
    const stamp = event?.updated_at || event?.created_at
    const ageMs = stamp ? now - new Date(stamp).getTime() : Infinity
    return ageMs >= STALE_PROCESSING_MS
  })
  if (staleProcessing.length) {
    console.warn(
      `[PayPal] webhook-retry: recovering ${staleProcessing.length} stale "processing" event(s)`
    )
  }

  const candidates = [...dueFailed, ...staleProcessing]
  if (!candidates.length) return

  console.info(
    `[PayPal] webhook-retry: evaluating ${candidates.length} event(s) (${dueFailed.length} failed, ${staleProcessing.length} stale)`
  )

  for (const event of candidates) {
    await attemptRetry(paypal, container, event)
  }
}

async function attemptRetry(
  paypal: PayPalModuleService,
  container: MedusaContainer,
  event: any
) {
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
    return
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
    return
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
      cart_completed: processed.cartCompleted,
    })

    if (processed.cartCompleted) {
      await paypal.recordMetric("webhook_cart_completed").catch(() => {})
    }
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

export const config = {
  name: "paypal-webhook-retry",
  schedule: "*/10 * * * *",
}
