"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayPalAdvancedCardProvider = void 0;
const utils_1 = require("@medusajs/framework/utils");
const card_service_1 = require("../../modules/paypal/payment-provider/card-service");
Object.defineProperty(exports, "PayPalAdvancedCardProvider", { enumerable: true, get: function () { return card_service_1.PayPalAdvancedCardProvider; } });
exports.default = (0, utils_1.ModuleProvider)(utils_1.Modules.PAYMENT, {
    services: [card_service_1.PayPalAdvancedCardProvider],
});
//# sourceMappingURL=index.js.map