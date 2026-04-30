import { model } from "@medusajs/framework/utils"

const PayPalMetric = model.define("paypal_metric", {
  id: model.id().primaryKey(),
  name: model.text().unique(),
  data: model.json().nullable(),
})

export default PayPalMetric
