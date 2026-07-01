/**
 * Pure mapping/validation helpers for PayPal capture & refund resource statuses.
 *
 * Kept free of any container/IO dependencies so the money-flow decisions (what
 * counts as a settled capture, when a refund must be rejected, how a PayPal
 * status maps onto a Medusa payment status) can be unit-tested in isolation.
 */

/** Map a PayPal capture status onto a Medusa payment status. */
export function mapPayPalCaptureStatus(
  status?: string
): "captured" | "pending" | "error" | "canceled" | null {
  const normalized = String(status || "").toUpperCase()
  if (!normalized) return null
  if (normalized === "COMPLETED") return "captured"
  if (normalized === "PENDING") return "pending"
  if (["DENIED", "DECLINED", "FAILED"].includes(normalized)) return "error"
  // A partially-refunded capture is still a captured payment — only a portion of
  // the funds was returned. Mapping it to "canceled" would wrongly unwind a live
  // capture, so it must stay "captured". A full refund/reversal does unwind it.
  if (normalized === "PARTIALLY_REFUNDED") return "captured"
  if (["REFUNDED", "REVERSED"].includes(normalized)) return "canceled"
  return null
}

/**
 * Effective status of a PayPal capture resource.
 *
 * The orders-capture response nests the capture under
 * `purchase_units[].payments.captures[]` — the order's own top-level status can
 * read COMPLETED while the capture is still PENDING — whereas the
 * authorizations-capture response is the capture object directly. Prefer the
 * nested capture status, falling back to the top level.
 */
export function extractCaptureStatus(resource: any): string {
  if (!resource || typeof resource !== "object") return ""
  const nested = resource?.purchase_units?.[0]?.payments?.captures?.[0]?.status
  return String(nested ?? resource.status ?? "").toUpperCase()
}

/**
 * True only when a capture resource is COMPLETED. A 2xx HTTP response does NOT
 * imply this: PayPal returns 201 for PENDING (pending review / eCheck),
 * DECLINED, and FAILED captures too.
 */
export function isCaptureCompleted(resource: any): boolean {
  return extractCaptureStatus(resource) === "COMPLETED"
}

/**
 * Refund statuses that mean the refund did NOT go through and must never be
 * recorded as a successful refund. PENDING is intentionally excluded: PayPal
 * processes refunds asynchronously and a pending refund settles later.
 */
export function isRefundFailureStatus(status?: string): boolean {
  return ["FAILED", "CANCELLED", "CANCELED", "DENIED"].includes(
    String(status || "").toUpperCase()
  )
}
