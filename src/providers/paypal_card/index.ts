import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { PayPalAdvancedCardProvider } from "../../modules/paypal/payment-provider/card-service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [PayPalAdvancedCardProvider],
})

export { PayPalAdvancedCardProvider }
