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
])

type CurrencyCheck = {
  currency: string
  overrideCurrency?: string
  supported: boolean
  errors: string[]
}

export function normalizeCurrencyCode(code?: string, fallback = "EUR") {
  const trimmed = String(code || "").trim()
  return (trimmed || fallback).toUpperCase()
}

export function isPayPalCurrencySupported(currencyCode: string) {
  return PAYPAL_SUPPORTED_CURRENCIES.has(normalizeCurrencyCode(currencyCode))
}

export function getPayPalCurrencyCompatibility(input: {
  currencyCode?: string
  paypalCurrencyOverride?: string
}): CurrencyCheck {
  const currency = normalizeCurrencyCode(input.currencyCode)
  const overrideCurrency = input.paypalCurrencyOverride
    ? normalizeCurrencyCode(input.paypalCurrencyOverride)
    : undefined
  const errors: string[] = []

  if (!isPayPalCurrencySupported(currency)) {
    errors.push(`PayPal does not support currency "${currency}".`)
  }

  if (overrideCurrency && overrideCurrency !== currency) {
    errors.push(
      `PayPal is configured for "${overrideCurrency}", but the store cart uses "${currency}".`
    )
  }

  return {
    currency,
    overrideCurrency,
    supported: errors.length === 0,
    errors,
  }
}

export function assertPayPalCurrencySupported(input: {
  currencyCode?: string
  paypalCurrencyOverride?: string
}) {
  const result = getPayPalCurrencyCompatibility(input)
  if (!result.supported) {
    throw new Error(result.errors.join(" "))
  }
  return result
}

export function getPayPalSupportedCurrencies() {
  return Array.from(PAYPAL_SUPPORTED_CURRENCIES.values())
}
