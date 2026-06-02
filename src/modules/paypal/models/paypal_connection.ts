import { model } from "@medusajs/framework/utils"

const PayPalConnection = model.define("paypal_connection", {
  id: model.id().primaryKey(),

  environment: model.text().default("live"),
  status: model.text().default("disconnected"),

  shared_id: model.text().nullable(),
  auth_code: model.text().nullable(),

  seller_client_id: model.text().nullable(),
  seller_client_secret: model.text().nullable(),
  seller_merchant_id: model.text().nullable(),
  seller_email: model.text().nullable(),

  app_access_token: model.text().nullable(),
  app_access_token_expires_at: model.dateTime().nullable(),

  metadata: model.json().default({}),
})

export default PayPalConnection
