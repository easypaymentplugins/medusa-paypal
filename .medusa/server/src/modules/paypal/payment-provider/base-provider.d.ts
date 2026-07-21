import { AbstractPaymentProvider } from "@medusajs/framework/utils";
import type { CreateAccountHolderInput, CreateAccountHolderOutput, DeletePaymentInput, DeletePaymentOutput, ProviderWebhookPayload, WebhookActionResult } from "@medusajs/framework/types";
import { PayPalCredentialResolver } from "../utils/credential-resolver";
export type Options = {};
/**
 * Shared base for the two PayPal payment providers (wallet buttons and advanced
 * card fields). Both providers ran nearly identical credential/token handling,
 * order-detail fetching, idempotency-key generation, amount normalization, and
 * PayPal→Medusa status mapping — that logic lives here once. Each provider
 * supplies its own `sessionPrefix` / `idempotencyPrefix` and keeps the pieces
 * that genuinely differ (create/authorize/capture/refund/cancel business logic,
 * metric recording, 3-D Secure handling, provider-id passthrough).
 */
export declare abstract class PayPalProviderBase extends AbstractPaymentProvider<Options> {
    protected readonly options_: Options;
    protected paypal: PayPalCredentialResolver;
    /** Prefix for generated session ids (e.g. "pp" or "pp_card"). */
    protected abstract readonly sessionPrefix: string;
    /** Prefix for generated idempotency keys (e.g. "pp" or "pp-card"). */
    protected abstract readonly idempotencyPrefix: string;
    constructor(cradle: Record<string, any>, options: Options);
    protected static resolvePgConnection(cradle: Record<string, any>): any;
    protected generateSessionId(): string;
    resolveSettings(): Promise<import("../utils/credential-resolver").ResolvedSettings>;
    protected resolveCurrencyOverride(): Promise<string>;
    protected getPayPalAccessToken(): Promise<import("../utils/credential-resolver").AccessTokenResult>;
    protected getOrderDetails(orderId: string): Promise<any>;
    protected getIdempotencyKey(input: {
        context?: {
            idempotency_key?: string;
        };
    }, suffix: string): string;
    protected normalizePaymentData(input: {
        data?: Record<string, unknown>;
    }): Promise<{
        data: Record<string, any>;
        amount: number;
        currencyCode: string;
    }>;
    protected formatAmount(amount: number, currencyCode?: string): string;
    /**
     * Amount to send to PayPal for a capture. Medusa invokes the provider's
     * capturePayment with only `{ data, context: { idempotency_key } }` — the
     * admin's requested (possibly partial) capture amount is never passed in the
     * input. The idempotency_key IS the Medusa `capture` row id, so resolve the
     * requested amount from that row; otherwise a partial capture would silently
     * charge the buyer the full session total. Falls back to the session amount
     * when the row can't be resolved (preserving full-capture behavior), and
     * never returns more than the session amount.
     */
    protected resolveRequestedCaptureAmount(input: {
        context?: {
            idempotency_key?: string;
        };
    }, sessionAmount: number): Promise<number>;
    /**
     * When the session amount or currency changes while a not-yet-approved PayPal
     * order is stored on the session, drop the stored order reference so the next
     * create-order call mints a fresh order at the correct total. Without this, a
     * buyer who opens PayPal (order created for the old total), backs out, and
     * changes the cart gets charged the stale amount. Returns a `{ paypal }`
     * patch to spread into the updated session data, or `{}` when nothing needs
     * invalidating. Sessions that already carry a capture/authorization are never
     * touched.
     */
    protected invalidateStaleOrder(input: {
        data?: Record<string, unknown>;
        amount?: unknown;
    }, nextCurrencyCode: string): Record<string, unknown>;
    protected mapCaptureStatus(status?: string): "pending" | "captured" | "canceled" | "error" | null;
    protected mapAuthorizationStatus(status?: string): "authorized" | "canceled" | "error" | null;
    protected mapOrderStatus(status?: string): "pending" | "authorized" | "captured" | "canceled" | "error";
    createAccountHolder(input: CreateAccountHolderInput): Promise<CreateAccountHolderOutput>;
    deletePayment(_input: DeletePaymentInput): Promise<DeletePaymentOutput>;
    getWebhookActionAndData(payload: ProviderWebhookPayload["payload"]): Promise<WebhookActionResult>;
}
//# sourceMappingURL=base-provider.d.ts.map