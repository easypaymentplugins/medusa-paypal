export const PAYPAL_WALLET_PROVIDER_ID = "pp_paypal_paypal" as const
export const PAYPAL_CARD_PROVIDER_ID = "pp_paypal_card_paypal_card" as const

export const PAYPAL_PROVIDER_IDS = [
  PAYPAL_WALLET_PROVIDER_ID,
  PAYPAL_CARD_PROVIDER_ID,
] as const

export const isPayPalProviderId = (providerId?: string | null) => {
  if (!providerId) return false

  return PAYPAL_PROVIDER_IDS.includes(
    providerId as (typeof PAYPAL_PROVIDER_IDS)[number]
  )
}
