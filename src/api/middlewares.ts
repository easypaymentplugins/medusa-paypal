import { defineMiddlewares } from "@medusajs/framework/http"

export default defineMiddlewares({
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
      matcher: "/store/paypal-complete",
      middlewares: [],
    },
    {
      matcher: "/store/paypal/:path*",
      middlewares: [],
    },
  ],
})
