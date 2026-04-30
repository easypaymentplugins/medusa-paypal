import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { PayPalPaymentProvider } from "../../modules/paypal/payment-provider/service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [PayPalPaymentProvider],
})

export { PayPalPaymentProvider }
