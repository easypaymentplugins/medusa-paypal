"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = void 0;
/**
 * PayPal webhook endpoint under the `/hooks` namespace.
 *
 * Medusa applies its store publishable-key middleware to EVERY `/store/*`
 * route, and PayPal's webhook delivery cannot send the
 * `x-publishable-api-key` header — so the original
 * `/store/paypal/webhook` endpoint is rejected with NOT_ALLOWED before the
 * handler runs unless a reverse proxy injects the header. The `/hooks`
 * namespace (the same one Medusa core uses for provider webhooks) has no such
 * guard, so external callers can reach it directly.
 *
 * The `/store/paypal/webhook` route is kept for deployments that already
 * inject the key at their edge; both paths share this exact handler. New
 * webhook registrations (and migrated existing ones) point at
 * `/hooks/paypal/webhook`.
 */
var route_1 = require("../../../store/paypal/webhook/route");
Object.defineProperty(exports, "POST", { enumerable: true, get: function () { return route_1.POST; } });
//# sourceMappingURL=route.js.map