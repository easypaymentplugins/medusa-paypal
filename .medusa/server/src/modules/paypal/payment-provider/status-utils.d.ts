/**
 * Pure mapping/validation helpers for PayPal capture & refund resource statuses.
 *
 * Kept free of any container/IO dependencies so the money-flow decisions (what
 * counts as a settled capture, when a refund must be rejected, how a PayPal
 * status maps onto a Medusa payment status) can be unit-tested in isolation.
 */
/** Map a PayPal capture status onto a Medusa payment status. */
export declare function mapPayPalCaptureStatus(status?: string): "captured" | "pending" | "error" | "canceled" | null;
/**
 * Effective status of a PayPal capture resource.
 *
 * The orders-capture response nests the capture under
 * `purchase_units[].payments.captures[]` — the order's own top-level status can
 * read COMPLETED while the capture is still PENDING — whereas the
 * authorizations-capture response is the capture object directly. Prefer the
 * nested capture status, falling back to the top level.
 */
export declare function extractCaptureStatus(resource: any): string;
/**
 * True only when a capture resource is COMPLETED. A 2xx HTTP response does NOT
 * imply this: PayPal returns 201 for PENDING (pending review / eCheck),
 * DECLINED, and FAILED captures too.
 */
export declare function isCaptureCompleted(resource: any): boolean;
/**
 * Refund statuses that mean the refund did NOT go through and must never be
 * recorded as a successful refund. PENDING is intentionally excluded: PayPal
 * processes refunds asynchronously and a pending refund settles later.
 */
export declare function isRefundFailureStatus(status?: string): boolean;
//# sourceMappingURL=status-utils.d.ts.map