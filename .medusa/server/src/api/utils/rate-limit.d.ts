import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
export type RateLimiterOptions = {
    /**
     * Env var holding the request cap for this limiter. Defaults to the shared
     * PAYPAL_RATE_LIMIT_MAX. The webhook routes pass their own dedicated var:
     * PayPal delivers from a handful of egress IPs, so a cap sized for
     * individual buyers would throttle legitimate webhook bursts (a sale spike)
     * into 429-driven redelivery loops.
     */
    maxEnvVar?: string;
    /** Env var for the window; defaults to PAYPAL_RATE_LIMIT_WINDOW_MS. */
    windowEnvVar?: string;
};
export declare function createRateLimiter(scope: string, options?: RateLimiterOptions): (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => void | MedusaResponse;
//# sourceMappingURL=rate-limit.d.ts.map