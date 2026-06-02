import { randomBytes } from "crypto"

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
  sellerNonce: "",
  bnCode: "MBJTechnolabs_SI_SPB",
  partnerMerchantIdSandbox: "K6QLN2LPGQRHL",
  partnerMerchantIdLive: "GT5R877JNBPLL",
  alertWebhookUrls: [],
}

function generateSellerNonce(): string {
  return randomBytes(32).toString("hex")
}

export function getPayPalConfig(): PayPalModuleConfig {
  const backendUrl = process.env.MEDUSA_BACKEND_URL || STATIC_CFG.backendUrl

  return {
    ...STATIC_CFG,
    partnerServiceUrl:
      process.env.PAYPAL_PARTNER_SERVICE_URL || STATIC_CFG.partnerServiceUrl,
    backendUrl,
    sellerNonce:
      process.env.PAYPAL_SELLER_NONCE || generateSellerNonce(),
    partnerMerchantIdSandbox:
      process.env.PAYPAL_PARTNER_MERCHANT_ID_SANDBOX || STATIC_CFG.partnerMerchantIdSandbox,
    partnerMerchantIdLive:
      process.env.PAYPAL_PARTNER_MERCHANT_ID_LIVE || STATIC_CFG.partnerMerchantIdLive,
    alertWebhookUrls:
      (process.env.PAYPAL_ALERT_WEBHOOK_URLS || "")
        .split(",")
        .map((url) => url.trim())
        .filter(Boolean) || STATIC_CFG.alertWebhookUrls,
  }
}
