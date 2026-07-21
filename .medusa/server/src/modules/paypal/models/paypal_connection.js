"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("@medusajs/framework/utils");
const PayPalConnection = utils_1.model.define("paypal_connection", {
    id: utils_1.model.id().primaryKey(),
    environment: utils_1.model.text().default("live"),
    status: utils_1.model.text().default("disconnected"),
    shared_id: utils_1.model.text().nullable(),
    auth_code: utils_1.model.text().nullable(),
    seller_client_id: utils_1.model.text().nullable(),
    seller_client_secret: utils_1.model.text().nullable(),
    seller_merchant_id: utils_1.model.text().nullable(),
    seller_email: utils_1.model.text().nullable(),
    app_access_token: utils_1.model.text().nullable(),
    app_access_token_expires_at: utils_1.model.dateTime().nullable(),
    metadata: utils_1.model.json().default({}),
});
exports.default = PayPalConnection;
//# sourceMappingURL=paypal_connection.js.map