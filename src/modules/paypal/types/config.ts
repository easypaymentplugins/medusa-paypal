export type PayPalModuleConfig = {
  partnerServiceUrl: string
  partnerJsUrl: string
  backendUrl: string
  sellerNonce: string
  bnCode?: string
  partnerMerchantIdSandbox: string
  partnerMerchantIdLive: string
  alertWebhookUrls?: string[]
}

const STATIC_CFG: PayPalModuleConfig = {
  partnerServiceUrl: "https://mbjtechnolabs.com/ppcp-seller-onboarding/seller-onboarding.php?from=medusa",
  partnerJsUrl: "https://www.paypal.com/webapps/merchantboarding/js/lib/lightbox/partner.js",
  backendUrl: "http://localhost:9000",
  sellerNonce: "a1233wtergfsdt4365tzrshgfbaewa36AGa1233wtergfsdt4365tzrshgfbaewa36AG",
  bnCode: "MBJTechnolabs_SI_SPB",
  partnerMerchantIdSandbox: "K6QLN2LPGQRHL",
  partnerMerchantIdLive: "GT5R877JNBPLL",
  alertWebhookUrls: [],
}

export function getPayPalConfig(): PayPalModuleConfig {
  return {
    ...STATIC_CFG,
    backendUrl: process.env.MEDUSA_BACKEND_URL || STATIC_CFG.backendUrl,
    alertWebhookUrls:
      (process.env.PAYPAL_ALERT_WEBHOOK_URLS || "")
        .split(",")
        .map((url) => url.trim())
        .filter(Boolean) || STATIC_CFG.alertWebhookUrls,
  }
}
