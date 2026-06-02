/**
 * Default timeout (ms) for all server-side outbound PayPal HTTP calls.
 *
 * Without a timeout, a slow or hung PayPal socket holds a Node request handler
 * (and any DB connection it owns) open indefinitely; under load these
 * accumulate and exhaust the event loop / connection pool, cascading into
 * checkout-wide failures. Override with PAYPAL_HTTP_TIMEOUT_MS.
 */
export const PAYPAL_HTTP_TIMEOUT_MS = (() => {
  const v = Number(process.env.PAYPAL_HTTP_TIMEOUT_MS)
  return Number.isFinite(v) && v > 0 ? v : 30_000
})()

/**
 * `fetch` that always enforces a timeout for PayPal / outbound calls. If the
 * caller already supplies an AbortSignal, it is respected as-is (the caller is
 * assumed to manage its own deadline).
 */
export function paypalFetch(
  input: string | URL,
  init: RequestInit = {}
): Promise<Response> {
  if (init.signal) {
    return fetch(input, init)
  }
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(PAYPAL_HTTP_TIMEOUT_MS),
  })
}
