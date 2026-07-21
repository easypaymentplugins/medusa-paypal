"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPayPalProviderId = exports.PAYPAL_PROVIDER_IDS = exports.PAYPAL_CARD_PROVIDER_ID = exports.PAYPAL_WALLET_PROVIDER_ID = void 0;
exports.PAYPAL_WALLET_PROVIDER_ID = "pp_paypal_paypal";
exports.PAYPAL_CARD_PROVIDER_ID = "pp_paypal_card_paypal_card";
exports.PAYPAL_PROVIDER_IDS = [
    exports.PAYPAL_WALLET_PROVIDER_ID,
    exports.PAYPAL_CARD_PROVIDER_ID,
];
const isPayPalProviderId = (providerId) => {
    if (!providerId)
        return false;
    return exports.PAYPAL_PROVIDER_IDS.includes(providerId);
};
exports.isPayPalProviderId = isPayPalProviderId;
//# sourceMappingURL=provider-ids.js.map