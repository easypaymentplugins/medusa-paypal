type CurrencyCheck = {
    currency: string;
    overrideCurrency?: string;
    supported: boolean;
    errors: string[];
};
export declare function normalizeCurrencyCode(code?: string, fallback?: string): string;
export declare function isPayPalCurrencySupported(currencyCode: string): boolean;
export declare function getPayPalCurrencyCompatibility(input: {
    currencyCode?: string;
    paypalCurrencyOverride?: string;
}): CurrencyCheck;
export declare function assertPayPalCurrencySupported(input: {
    currencyCode?: string;
    paypalCurrencyOverride?: string;
}): CurrencyCheck;
export declare function getPayPalSupportedCurrencies(): string[];
export {};
//# sourceMappingURL=currencies.d.ts.map