import { model } from "@medusajs/framework/utils"

const PayPalWebhookEvent = model.define("paypal_webhook_event", {
  id: model.id().primaryKey(),
  event_id: model.text().unique(),
  event_type: model.text(),
  event_version: model.text().nullable(),
  transmission_id: model.text().nullable(),
  transmission_time: model.dateTime().nullable(),
  status: model.text().default("pending"),
  attempt_count: model.number().default(0),
  next_retry_at: model.dateTime().nullable(),
  processed_at: model.dateTime().nullable(),
  last_error: model.text().nullable(),
  resource_id: model.text().nullable(),
  payload: model.json().nullable(),
})

export default PayPalWebhookEvent
