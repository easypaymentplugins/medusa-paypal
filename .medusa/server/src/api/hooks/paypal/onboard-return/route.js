"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = void 0;
/**
 * PayPal onboarding `return_url` under the `/hooks` namespace.
 *
 * PayPal redirects the onboarding popup here as a plain top-level browser
 * navigation, which carries no `x-publishable-api-key` header — and Medusa's
 * store publishable-key middleware rejects every `/store/*` request without
 * that header before the handler runs. Hosting the return bridge under
 * `/hooks` (no publishable-key guard) lets the popup complete the credential
 * exchange and close itself.
 *
 * The legacy `/store/paypal/onboard-return` route is kept for deployments
 * whose edge injects the key; both paths share this exact handler. Newly
 * generated onboarding links point at `/hooks/paypal/onboard-return`.
 */
var route_1 = require("../../../store/paypal/onboard-return/route");
Object.defineProperty(exports, "GET", { enumerable: true, get: function () { return route_1.GET; } });
//# sourceMappingURL=route.js.map