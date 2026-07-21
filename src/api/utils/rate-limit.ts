import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * Lightweight in-memory rate limiter for the public store payment routes.
 *
 * The store PayPal routes (create-order, capture-order, paypal-complete) are
 * unauthenticated by necessity, so without a limit a caller can hammer them —
 * e.g. enumerate cart ids and create unbounded PayPal orders against the
 * merchant account. This applies a fixed-window per-client cap.
 *
 * OPT-IN: disabled unless `PAYPAL_RATE_LIMIT_MAX` is set to a positive number.
 * This is deliberate — behind a load balancer / CDN that doesn't forward the
 * real client IP, every request would share one bucket and a low limit could
 * block legitimate checkouts. Merchants opt in once they've confirmed the real
 * client IP reaches the app (e.g. `x-forwarded-for` is set correctly).
 *
 * NOTE: the counter lives in process memory, so the limit is enforced per
 * server instance, not globally across a horizontally-scaled deployment. It is
 * a pragmatic first line of defense and a backstop; a shared store (Redis) or
 * an edge/CDN limiter is the right tool for a hard global guarantee. Tunable via
 * PAYPAL_RATE_LIMIT_MAX (requests) and PAYPAL_RATE_LIMIT_WINDOW_MS (window).
 */

const DEFAULT_WINDOW_MS = 60_000

// Cap the number of distinct client buckets we retain so a flood of unique
// client keys can't grow the map unbounded (a memory-exhaustion vector of its
// own). Oldest buckets are evicted first once the cap is hit.
const MAX_BUCKETS = 10_000

type Bucket = { count: number; resetAt: number }

function readEnvInt(name: string, fallback: number): number {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

/** The configured max, or null when rate limiting is disabled (opt-in). */
function readConfiguredMax(): number | null {
  const raw = process.env.PAYPAL_RATE_LIMIT_MAX
  if (raw === undefined || raw === "") return null
  const v = Number(raw)
  return Number.isFinite(v) && v > 0 ? v : null
}

function clientKey(req: MedusaRequest): string {
  // Use the RIGHT-most x-forwarded-for entry: proxies append the address they
  // received the request from, so the right-most value was written by the
  // merchant's own edge proxy and cannot be forged by the client. The
  // left-most entry is fully client-controlled — keying on it would let an
  // attacker rotate a header value to get a fresh bucket per request,
  // bypassing the limiter entirely.
  const fwd = req.headers["x-forwarded-for"]
  const fwdRaw = Array.isArray(fwd) ? fwd[fwd.length - 1] : fwd
  const parts = fwdRaw
    ? fwdRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : []
  const ip =
    parts[parts.length - 1] ||
    req.socket?.remoteAddress ||
    "unknown"
  return ip
}

export function createRateLimiter(scope: string) {
  const buckets = new Map<string, Bucket>()

  return function rateLimit(
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) {
    // Opt-in: with no configured max, this middleware is a pass-through so
    // existing deployments (especially behind a shared-IP proxy) are unaffected.
    const max = readConfiguredMax()
    if (max === null) {
      return next()
    }
    const windowMs = readEnvInt("PAYPAL_RATE_LIMIT_WINDOW_MS", DEFAULT_WINDOW_MS)
    const now = Date.now()
    const key = `${scope}:${clientKey(req)}`

    let bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs }
      buckets.set(key, bucket)
    }

    bucket.count += 1

    if (buckets.size > MAX_BUCKETS) {
      // Evict expired buckets first; if still over, drop the oldest inserted.
      for (const [k, b] of buckets) {
        if (b.resetAt <= now) buckets.delete(k)
        if (buckets.size <= MAX_BUCKETS) break
      }
      while (buckets.size > MAX_BUCKETS) {
        const oldest = buckets.keys().next().value
        if (oldest === undefined) break
        buckets.delete(oldest)
      }
    }

    if (bucket.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      res.setHeader("Retry-After", String(retryAfterSec))
      return res
        .status(429)
        .json({ message: "Too many requests. Please slow down and try again." })
    }

    return next()
  }
}
