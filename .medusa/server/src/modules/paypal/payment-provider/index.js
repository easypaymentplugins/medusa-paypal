"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayPalAdvancedCardProvider = exports.PayPalPaymentProvider = void 0;
const utils_1 = require("@medusajs/framework/utils");
const service_1 = __importDefault(require("./service"));
exports.PayPalPaymentProvider = service_1.default;
const card_service_1 = __importDefault(require("./card-service"));
exports.PayPalAdvancedCardProvider = card_service_1.default;
exports.default = (0, utils_1.ModuleProvider)(utils_1.Modules.PAYMENT, {
    services: [
        service_1.default,
        card_service_1.default,
    ],
});
//# sourceMappingURL=index.js.map