"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayPalPaymentProvider = void 0;
const utils_1 = require("@medusajs/framework/utils");
const service_1 = require("../../modules/paypal/payment-provider/service");
Object.defineProperty(exports, "PayPalPaymentProvider", { enumerable: true, get: function () { return service_1.PayPalPaymentProvider; } });
exports.default = (0, utils_1.ModuleProvider)(utils_1.Modules.PAYMENT, {
    services: [service_1.PayPalPaymentProvider],
});
//# sourceMappingURL=index.js.map