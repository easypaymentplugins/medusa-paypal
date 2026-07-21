"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPayPalApiBase = getPayPalApiBase;
function getPayPalApiBase(environment) {
    return environment === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";
}
//# sourceMappingURL=paypal-auth.js.map