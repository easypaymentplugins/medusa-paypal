"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("@medusajs/framework/utils");
const PayPalWebhookEvent = utils_1.model.define("paypal_webhook_event", {
    id: utils_1.model.id().primaryKey(),
    event_id: utils_1.model.text().unique(),
    event_type: utils_1.model.text(),
    event_version: utils_1.model.text().nullable(),
    transmission_id: utils_1.model.text().nullable(),
    transmission_time: utils_1.model.dateTime().nullable(),
    status: utils_1.model.text().default("pending"),
    attempt_count: utils_1.model.number().default(0),
    next_retry_at: utils_1.model.dateTime().nullable(),
    processed_at: utils_1.model.dateTime().nullable(),
    last_error: utils_1.model.text().nullable(),
    resource_id: utils_1.model.text().nullable(),
    payload: utils_1.model.json().default({}),
});
exports.default = PayPalWebhookEvent;
//# sourceMappingURL=paypal_webhook_event.js.map