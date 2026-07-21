export type PayPalModuleConfig = {
    partnerServiceUrl: string;
    partnerJsUrl: string;
    backendUrl: string;
    sellerNonce: string;
    bnCode?: string;
    partnerMerchantIdSandbox: string;
    partnerMerchantIdLive: string;
    alertWebhookUrls?: string[];
};
export declare function getPayPalConfig(): PayPalModuleConfig;
//# sourceMappingURL=config.d.ts.map