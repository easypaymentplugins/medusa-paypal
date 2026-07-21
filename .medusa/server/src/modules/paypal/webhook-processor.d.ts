import type { MedusaContainer } from "@medusajs/framework/types";
export declare const EVENT_STATUS_MAP: Record<string, "authorized" | "captured" | "canceled" | "error">;
export declare function isTransitionAllowed(from: string, to: string): boolean;
export declare const SUPPORTED_EVENT_PREFIXES: string[];
export declare function isAllowedEventType(eventType: string): boolean;
export declare function isRetryableError(error: unknown): boolean;
export declare const MAX_WEBHOOK_ATTEMPTS: number;
export declare function computeNextRetryAt(attemptCount: number): Date | null;
export declare function normalizeResource(payload: Record<string, any>): Record<string, any>;
export declare function normalizeEventVersion(payload: Record<string, any>): string | null;
/** Pull the capture id out of a refund resource's "up" HATEOAS link. */
export declare function extractCaptureIdFromLinks(resource: Record<string, any>): string | null;
export interface ExtractedIdentifiers {
    orderId: string | null;
    captureId: string | null;
    refundId: string | null;
    cartId: string | null;
}
export declare function extractIdentifiers(resource: Record<string, any>, eventType: string): ExtractedIdentifiers;
/**
 * True when a refund resource demonstrably covers less than the captured
 * amount. Uses the refund's cumulative `total_refunded_amount` (falling back
 * to the single refund amount) against the capture amount stored on the
 * session (falling back to the session total). Returns false — i.e. treat as
 * a full refund, matching the previous behavior — whenever the amounts can't
 * be determined.
 */
export declare function isPartialRefund(resource: Record<string, any>, sessionData: Record<string, any>): boolean;
export interface ProcessResult {
    orderId: string | null;
    captureId: string | null;
    refundId: string | null;
    cartId: string | null;
    sessionUpdated: boolean;
}
export declare function processPayPalWebhookEvent(container: MedusaContainer, input: {
    eventType: string;
    payload: Record<string, any>;
}): Promise<ProcessResult>;
//# sourceMappingURL=webhook-processor.d.ts.map