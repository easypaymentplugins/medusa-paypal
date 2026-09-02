# Changelog

All notable changes to `@easypayment/medusa-payment-paypal` are documented here.

## 1.2.0 — 2026-09-02

### Fixed
- **A cart edit can no longer resurrect a stale-amount PayPal order.** The
  create-order `PayPal-Request-Id` now includes the cart total and currency.
  Previously it was derived from the cart id alone, so after the buyer changed
  the cart, the "create a fresh order" path was silently answered from PayPal's
  idempotency cache with the ORIGINAL order at the original total.
- **`capture-order` no longer reports success for a capture that never
  completed.** The existing-capture short-circuit now requires a demonstrably
  COMPLETED capture; a webhook-patched `capture_id` (which is also written for
  DENIED/PENDING captures) is verified against the live PayPal order before
  being returned as success, so a declined payment surfaces as retryable
  instead of "payment processed but order could not be finalized".
- **The capture-order idempotency key is now scoped per order.** A client
  reusing one `Idempotency-Key` header across two orders could previously
  receive order A's cached capture for order B. Also fixed the internal
  variable shadowing so the request-correlation UUID appears consistently in
  logs.
- **Canceling a captured payment no longer records success for a refund that
  failed.** Both providers' `cancelPayment` now reject FAILED/CANCELLED/DENIED
  refund statuses (PayPal returns 2xx for those too), matching the existing
  `refundPayment` gate.

### Added
- **Webhook-driven cart completion (safety net).** When a
  `PAYMENT.CAPTURE.COMPLETED` webhook arrives for a cart the buyer never
  finalized (closed tab or crash right after paying), the plugin now completes
  the cart server-side so a captured payment always produces an order. Races
  with the storefront's own completion are handled (whoever wins, the other
  treats it as success); genuine failures follow the webhook retry schedule and
  stay visible in the dead-letter queue. Disable with
  `PAYPAL_WEBHOOK_COMPLETE_CART=false`. New metric: `webhook_cart_completed`.

### Hardened
- **Metric writes are now atomic everywhere.** The module service's
  `recordMetric` uses the same single-statement `INSERT ... ON CONFLICT`
  upsert as the payment providers (shared `utils/metrics.ts`), so concurrent
  routes/webhooks can no longer lose increments to a read-modify-write race.
- **Settings singleton reads are deterministic.** All readers (module service
  and the providers' raw-SQL credential resolver) now order by `created_at
  ASC`, and a first-boot save race merges into the canonical row instead of
  leaving a divergent duplicate.
- **Webhook endpoints can be rate-limited** (opt-in, separate from the buyer
  routes): set `PAYPAL_WEBHOOK_RATE_LIMIT_MAX` /
  `PAYPAL_WEBHOOK_RATE_LIMIT_WINDOW_MS`. Deliberately NOT tied to
  `PAYPAL_RATE_LIMIT_MAX` — PayPal delivers from a handful of egress IPs, so a
  buyer-sized cap would throttle legitimate webhook bursts.
- **Card provider observability parity.** The advanced-card provider now
  records the same audit events and metrics as the wallet provider
  (`capture_success`/`capture_failed`, `refund_*`, `void_success`,
  `cancel_*`, `authorize_failed`), converts capture errors to `MedusaError`
  so real PayPal failure reasons are not masked in production, and preserves
  the `provider_id` passthrough in `updatePayment`.
- **Startup warning when `PAYPAL_SELLER_NONCE` is auto-generated** — in
  multi-instance deployments a per-process nonce can race the onboarding
  code_verifier; the warning tells operators to pin it.
- **Single source of truth for the BN code and API base URLs** (removed 4
  duplicated constants and 9 duplicated environment ternaries).
- `npm run typecheck` (full `tsc --noEmit`, admin UI included) now passes and
  runs in CI; added `@types/react`/`react` dev dependencies.

## 1.1.0

### Fixed (re-audit)
- **PayPal webhooks and the onboarding return bridge now work without a
  publishable API key.** Medusa applies its store publishable-key middleware to
  every `/store/*` route, and PayPal cannot send `x-publishable-api-key` — so
  webhook deliveries and onboarding return redirects to the old `/store/paypal/*`
  paths were rejected before the handlers ran. Both handlers are now also served
  from `/hooks/paypal/webhook` and `/hooks/paypal/onboard-return` (no key
  guard). New registrations use the `/hooks` URLs, and existing PayPal webhook
  registrations pointing at the legacy path are migrated in place (best-effort,
  on admin status view) via PayPal's webhook PATCH API. The legacy `/store`
  routes remain for deployments that inject the key at their edge.
- **Unapproved orders can no longer be booked as authorized.** `authorizePayment`
  treated a PayPal order in `CREATED`/`SAVED` status as authorized, letting a
  cart complete (order placed, inventory reserved) with no payment approved at
  PayPal at all. Only buyer-`APPROVED` orders now count.
- **PENDING / DECLINED captures are no longer booked as captured.** The
  idempotency branches of `authorizePayment` (both providers) keyed off the mere
  presence of a capture/authorization id and returned the settings-derived
  status. They now derive the status from the actual PayPal resource: a
  `COMPLETED` capture → captured; a `PENDING` (eCheck) capture → authorized
  (order placed, funds not claimed until the `CAPTURE.COMPLETED` webhook); a
  `DENIED`/`DECLINED`/`FAILED` capture → error.
- **Partial captures no longer charge the full amount.** Medusa never passes the
  requested capture amount to a provider — only the Medusa capture-row id (as
  `context.idempotency_key`). The providers now resolve the requested amount
  from that row, so an admin capturing €40 of a €100 authorization no longer
  sends a €100 capture to PayPal.
- **Stale PayPal orders are invalidated when the cart changes.** `updatePayment`
  now drops the stored `paypal.order_id` when the session amount/currency
  changes (before any capture/authorization), and `create-order` verifies a
  stored order's amount, currency, and state against the cart before reusing it
  — so a buyer who backs out of the PayPal popup and edits their cart is charged
  the new total, not the stale one.
- **Card provider no longer 422s on approved capture-intent orders.** Its
  `authorizePayment` called `/v2/checkout/orders/{id}/authorize` regardless of
  intent, which PayPal rejects (`UNSUPPORTED_INTENT`) for `CAPTURE`-intent
  orders — permanently stranding a checkout whose storefront capture call had
  failed after 3-D Secure approval. Approved orders now return `authorized` and
  the capture is routed by intent; `/authorize` is only called for
  `AUTHORIZE`-intent orders. The impossible create-order-then-authorize
  fallbacks (both providers) were replaced with clear errors.
- **Webhook processing no longer corrupts session data.** `PAYMENT.CAPTURE.REFUNDED`
  / `REVERSED` events carry a *refund* resource — its id was being stored as the
  session's `capture_id`. Identifiers are now extracted refund-aware (with the
  capture id taken from `related_ids` or the resource's "up" link), and patches
  no longer overwrite stored fields (e.g. `order_id`) with null when an event
  lacks them.
- **Partial refunds no longer cancel the payment session.** Refund events now
  compare the cumulative refunded total against the captured amount and keep the
  session status for partial refunds (recording the refund data); only full
  refunds transition the session to canceled.
- **Rate limiter can no longer be bypassed via `X-Forwarded-For`.** The client
  key now uses the right-most (proxy-appended) XFF entry instead of the
  left-most (client-forgeable) one.
- **`paypal-complete` no longer 500s on an empty/non-JSON body** (missing body
  guard before destructuring).
- **Client-supplied idempotency keys are now cart-scoped in `create-order`**, so
  a reused `Idempotency-Key` header across two carts can no longer return cart
  A's cached PayPal order (and amount) for cart B.
- **Circuit breaker is now keyed per host.** Failures of a non-PayPal host (e.g.
  the onboarding service) can no longer open the breaker and block live
  captures/refunds against a healthy PayPal API.
- **Raw-knex reads now respect soft deletes** (`paypal_connection` /
  `paypal_settings` lookups in the credential resolver filter `deleted_at`).
- **Removed the broken `./workflows` package export** (it pointed at a file that
  was never built; importing it always failed).

### Added (re-audit)
- `GET /store/paypal/config` now emits `disable_buttons` (from
  `paypal_settings.disableButtons` / `disable_buttons`), which the UI package
  has always read to build the SDK's `disable-funding` list.


### Fixed
- **Transient capture/refund failures now retry.** The `paypalFetchWithRetry`
  wrapper (jittered backoff on 5xx/429/timeout) was implemented but never wired
  in — capture and refund used the non-retrying path. They now retry safely: the
  `PayPal-Request-Id` idempotency key means a retry re-uses the same
  capture/refund instead of double-charging.
- **Provider `recordMetric` is now atomic.** The credential-resolver metric path
  used by the payment providers (capture/refund/authorize success & failure
  counters) now uses a single `INSERT … ON CONFLICT … count = count + 1` upsert
  instead of a read-modify-write, so concurrent captures/refunds no longer lose
  increments. (The module-service metric path remains best-effort and unchanged.)
- **Capture persisted-but-lost gap is now observable.** After a successful PayPal
  capture, session persistence is retried, and if it still fails the route logs
  CRITICAL and records a `capture_order_persist_failed` metric instead of
  silently swallowing the error (the webhook and `paypal-complete`'s live
  re-derivation remain the reconciliation backstop).
- **Card provider partial-capture idempotency key** now includes the amount, so
  two sequential partial captures of the same order are no longer deduplicated by
  PayPal into one (matching the wallet provider).

### Added
- **Asynchronous webhook processing.** The webhook route now verifies, persists,
  and acknowledges (200) immediately, then processes off the request path via a
  subscriber — so PayPal's ~15s delivery timeout is never tripped by slow
  downstream work. The retry cron additionally recovers events left in
  `processing` past a staleness threshold, so an event is never lost even if the
  event bus drops a message.
- **Opt-in rate limiting** on the public store payment routes (`create-order`,
  `capture-order`, `paypal-complete`). Disabled by default (a pass-through) so
  existing deployments are unaffected; enable by setting `PAYPAL_RATE_LIMIT_MAX`
  (and optionally `PAYPAL_RATE_LIMIT_WINDOW_MS`) once you've confirmed the real
  client IP reaches the app (e.g. behind a proxy that forwards `x-forwarded-for`).
- **Encryption-key guardrail.** When `PAYPAL_ENCRYPTION_KEY` is unset, secrets
  now emit a loud (production-flagged) warning; set `PAYPAL_ENCRYPTION_STRICT=true`
  to fail closed instead of persisting plaintext secrets.
- Additional unit tests: retry/circuit-breaker behavior, the rate limiter, the
  atomic metric upsert, and session-persistence retry.

### Changed
- **`client_token` is only issued when advanced card fields are enabled** — the
  PayPal-buttons flow uses just `client_id`, so an unauthenticated config fetch no
  longer hands out a card-fields token it won't use.
- **`postMessage` target origin** for the onboarding return popup is now
  configurable (`PAYPAL_ADMIN_ORIGIN`, falling back to the first `ADMIN_CORS`
  entry) instead of the `"*"` wildcard.
- **Shared provider base class.** The wallet and advanced-card providers now
  extend a common `PayPalProviderBase` for the identical credential/token
  handling, order lookups, idempotency keys, amount normalization, and status
  mapping — removing a large block of duplicated code. Behavior is unchanged.
- Centralized the PayPal partner-attribution (BN) code into a single constant and
  removed the unused `PayPalSellerClient` dead code.

## 1.0.2

### Fixed
- `toAmountNumber` no longer silently coerces a blank string (`""` / `"   "`) or a
  blank serialized `BigNumber` value to `0`. `Number("")` is `0`, so a blank amount
  could previously turn a partial refund/capture into a full one — it now throws
  instead, consistent with the function's existing guards against `NaN`/unparseable
  input.

### Added
- Unit test suite (vitest) covering the money-critical, IO-free logic:
  amount coercion & currency formatting, currency support checks, capture/refund
  status mapping, secret encryption/decryption (AES-256-GCM round-trip, tamper &
  missing-key handling), webhook signature request composition, the webhook state
  machine, retry scheduling, identifier extraction, and provider-id detection.
