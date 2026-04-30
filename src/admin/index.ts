import { definePlugin } from "@medusajs/admin-sdk"
import paypalRoute from "./routes/settings/paypal/page"

export default definePlugin({
  id: "paypal-backend",
  routes: [paypalRoute],
})
