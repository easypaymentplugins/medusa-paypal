import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
export declare function createRateLimiter(scope: string): (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => void | MedusaResponse;
//# sourceMappingURL=rate-limit.d.ts.map