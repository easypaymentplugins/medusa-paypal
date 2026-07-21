"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeCurrencyCode = normalizeCurrencyCode;
exports.isPayPalCurrencySupported = isPayPalCurrencySupported;
exports.getPayPalCurrencyCompatibility = getPayPalCurrencyCompatibility;
exports.assertPayPalCurrencySupported = assertPayPalCurrencySupported;
exports.getPayPalSupportedCurrencies = getPayPalSupportedCurrencies;
const PAYPAL_SUPPORTED_CURRENCIES = new Set([
    "AUD",
    "BRL",
    "CAD",
    "CHF",
    "CZK",
    "DKK",
    "EUR",
    "GBP",
    "HKD",
    "HUF",
    "ILS",
    "JPY",
    "MXN",
    "MYR",
    "NOK",
    "NZD",
    "PHP",
    "PLN",
    "SEK",
    "SGD",
    "THB",
    "TWD",
    "USD",
]);
function normalizeCurrencyCode(code, fallback = "EUR") {
    const trimmed = String(code || "").trim();
    return (trimmed || fallback).toUpperCase();
}
function isPayPalCurrencySupported(currencyCode) {
    return PAYPAL_SUPPORTED_CURRENCIES.has(normalizeCurrencyCode(currencyCode));
}
function getPayPalCurrencyCompatibility(input) {
    const currency = normalizeCurrencyCode(input.currencyCode);
    const overrideCurrency = input.paypalCurrencyOverride
        ? normalizeCurrencyCode(input.paypalCurrencyOverride)
        : undefined;
    const errors = [];
    if (!isPayPalCurrencySupported(currency)) {
        errors.push(`PayPal does not support currency "${currency}".`);
    }
    if (overrideCurrency && overrideCurrency !== currency) {
        errors.push(`PayPal is configured for "${overrideCurrency}", but the store cart uses "${currency}".`);
    }
    return {
        currency,
        overrideCurrency,
        supported: errors.length === 0,
        errors,
    };
}
function assertPayPalCurrencySupported(input) {
    const result = getPayPalCurrencyCompatibility(input);
    if (!result.supported) {
        throw new Error(result.errors.join(" "));
    }
    return result;
}
function getPayPalSupportedCurrencies() {
    return Array.from(PAYPAL_SUPPORTED_CURRENCIES.values());
}
//# sourceMappingURL=currencies.js.map