"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = require("@medusajs/framework/http");
const rate_limit_1 = require("./utils/rate-limit");
exports.default = (0, http_1.defineMiddlewares)({
    routes: [
        {
            // Keep the exact bytes PayPal signed (`req.rawBody`) so webhook signature
            // verification hashes the original payload, not a re-serialized copy. This
            // entry must precede the "/store/paypal/:path*" catch-all below.
            matcher: "/store/paypal/webhook",
            method: ["POST"],
            bodyParser: { preserveRawBody: true },
            middlewares: [],
        },
        {
            // Same raw-body requirement for the /hooks mirror of the webhook route —
            // the path external PayPal deliveries actually reach, since Medusa's
            // publishable-key middleware blocks unauthenticated POSTs to /store/*.
            matcher: "/hooks/paypal/webhook",
            method: ["POST"],
            bodyParser: { preserveRawBody: true },
            middlewares: [],
        },
        {
            // Rate-limit the order-creating route: unauthenticated by necessity, so
            // cap how fast one client can spin up PayPal orders on the merchant
            // account. Each createRateLimiter() call builds its own counter at boot.
            matcher: "/store/paypal/create-order",
            method: ["POST"],
            middlewares: [(0, rate_limit_1.createRateLimiter)("create-order")],
        },
        {
            matcher: "/store/paypal/capture-order",
            method: ["POST"],
            middlewares: [(0, rate_limit_1.createRateLimiter)("capture-order")],
        },
        {
            matcher: "/store/paypal-complete",
            method: ["POST"],
            middlewares: [(0, rate_limit_1.createRateLimiter)("paypal-complete")],
        },
        {
            matcher: "/store/paypal/:path*",
            middlewares: [],
        },
    ],
});
//# sourceMappingURL=middlewares.js.map