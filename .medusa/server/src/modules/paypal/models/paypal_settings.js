"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("@medusajs/framework/utils");
const PayPalSettings = utils_1.model.define("paypal_settings", {
    id: utils_1.model.id().primaryKey(),
    data: utils_1.model.json().nullable(),
});
exports.default = PayPalSettings;
//# sourceMappingURL=paypal_settings.js.map