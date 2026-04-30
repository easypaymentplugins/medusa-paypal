import { defineMiddlewares } from "@medusajs/framework/http"

export default defineMiddlewares({
  routes: [
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
