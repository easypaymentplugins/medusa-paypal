import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
/**
 * Public PayPal onboarding `return_url`.
 *
 * When a seller finishes onboarding, PayPal redirects the mini-browser popup to
 * this URL as a plain top-level navigation (no auth header / no publishable key),
 * which is why it must live under the public `/store/paypal/*` namespace rather
 * than `/admin/*`. Leaving the popup on a raw JSON / 401 / 405 page is exactly
 * what made the popup appear to "never close".
 *
 * This route is the authoritative, partner.js-independent completion path. It:
 *   1. exchanges PayPal's `authCode` + `sharedId` for seller credentials
 *      server-side (idempotent — safe even if partner.js's onboardingCallback or
 *      admin status polling also completes the exchange),
 *   2. relays whatever query params PayPal appended back to the opener (the
 *      Medusa Admin connection page) via postMessage so it can refresh
 *      immediately, and
 *   3. closes the popup.
 *
 * Because the exchange no longer depends on the opener receiving an in-flight
 * postMessage, onboarding completes (and the admin page flips to "connected" via
 * its status poll) even when partner.js never fires its callback.
 */
export declare function GET(req: MedusaRequest, res: MedusaResponse): Promise<MedusaResponse>;
//# sourceMappingURL=route.d.ts.map