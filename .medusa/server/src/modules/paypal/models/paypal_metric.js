"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("@medusajs/framework/utils");
const PayPalMetric = utils_1.model.define("paypal_metric", {
    id: utils_1.model.id().primaryKey(),
    name: utils_1.model.text().unique(),
    data: utils_1.model.json().default({}),
});
exports.default = PayPalMetric;
//# sourceMappingURL=paypal_metric.js.map