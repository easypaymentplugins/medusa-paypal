type Environment = "sandbox" | "live";
interface ActiveCredentials {
    environment: Environment;
    client_id: string;
    client_secret: string;
}
export interface AccessTokenResult {
    accessToken: string;
    base: string;
}
export interface ResolvedSettings {
    additionalSettings: Record<string, unknown>;
    advancedCardSettings: Record<string, unknown>;
    apiDetails: Record<string, unknown>;
}
/**
 * Self-contained credential and token management for PayPal payment providers.
 *
 * Payment providers in Medusa v2 run inside the payment module's scoped
 * container, which is isolated from the application container where the
 * PayPal module service lives. This resolver bypasses the container boundary
 * entirely by reading credentials directly from the database via pgConnection
 * (knex), which Medusa injects into every module container.
 *
 * Same source of truth (paypal_connection / paypal_settings tables), zero
 * cross-container dependencies.
 */
export declare class PayPalCredentialResolver {
    private db;
    private tokenRefreshPromise;
    constructor(pgConnection: any);
    private getConnectionRow;
    /**
     * Resolve the amount an admin actually requested for a capture.
     *
     * Medusa does NOT pass the requested capture amount to the provider — only
     * `context.idempotency_key`, which is the Medusa `capture` row id. Without
     * this lookup the provider can only capture the full session amount, which
     * over-charges the buyer on partial captures. Returns null when the id
     * doesn't resolve (caller falls back to the session amount).
     */
    getRequestedCaptureAmount(captureRowId: string): Promise<number | null>;
    private getEnvCreds;
    getActiveCredentials(): Promise<ActiveCredentials>;
    getAccessToken(): Promise<AccessTokenResult>;
    private refreshAccessToken;
    getSettings(): Promise<ResolvedSettings>;
    recordAuditEvent(eventType: string, metadata?: Record<string, unknown>): Promise<void>;
    recordMetric(name: string, metadata?: Record<string, unknown>): Promise<void>;
}
export {};
//# sourceMappingURL=credential-resolver.d.ts.map