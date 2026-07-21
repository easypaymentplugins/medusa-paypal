import type { AuthenticatedMedusaRequest, MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
/**
 * The PayPal onboarding `return_url` (the page the mini-browser popup lands on)
 * is the PUBLIC route `GET /store/paypal/onboard-return` — `/admin/*` routes
 * require an auth token that a top-level popup navigation cannot carry, which
 * would leave the popup stuck on a 401 page. This admin GET is therefore not part
 * of the browser flow; it only documents the contract for the POST below.
 */
export declare function GET(_req: MedusaRequest, res: MedusaResponse): Promise<MedusaResponse>;
export declare function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<MedusaResponse>;
//# sourceMappingURL=route.d.ts.map