/**
 * Outbound HTTP for PayPal API calls with timeout, circuit breaker, and
 * optional retry for critical payment operations.
 */
export declare const PAYPAL_HTTP_TIMEOUT_MS: number;
export declare function paypalFetch(input: string | URL, init?: RequestInit): Promise<Response>;
export declare function paypalFetchWithRetry(input: string | URL, init?: RequestInit): Promise<Response>;
//# sourceMappingURL=paypal-fetch.d.ts.map