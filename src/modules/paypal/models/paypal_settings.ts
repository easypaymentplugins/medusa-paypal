import { model } from "@medusajs/framework/utils"

const PayPalSettings = model.define("paypal_settings", {
  id: model.id().primaryKey(),
  data: model.json().nullable(),
})

export default PayPalSettings
