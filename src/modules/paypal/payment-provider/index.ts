import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import PayPalPaymentProvider from "./service"
import PayPalAdvancedCardProvider from "./card-service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [
    PayPalPaymentProvider,
    PayPalAdvancedCardProvider,
  ],
})

export {
  PayPalPaymentProvider,
  PayPalAdvancedCardProvider,
}
