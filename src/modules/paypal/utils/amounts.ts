const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  // PayPal does NOT support decimals for HUF, JPY and TWD — even though HUF and
  // TWD have 2 ISO 4217 minor digits, PayPal rejects amounts like "1000.00" for
  // them (DECIMAL_PRECISION). They must be sent as whole numbers ("1000").
  // See https://developer.paypal.com/api/rest/reference/currency-codes/
  "HUF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "TWD",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
])

const THREE_DECIMAL_CURRENCIES = new Set(["BHD", "IQD", "JOD", "KWD", "OMR", "TND"])

export function getCurrencyExponent(currencyCode: string) {
  const code = currencyCode.toUpperCase()
  if (ZERO_DECIMAL_CURRENCIES.has(code)) {
    return 0
  }
  if (THREE_DECIMAL_CURRENCIES.has(code)) {
    return 3
  }
  return 2
}

/**
 * Format a Medusa amount for the PayPal REST API.
 *
 * Medusa passes monetary amounts to payment providers in MAJOR units
 * (e.g. `10` for €10.00), and PayPal's Orders/Payments API also expects major
 * units as a string (e.g. `"10.00"`). So this only fixes the decimal precision
 * for the currency — it must NOT divide/convert to minor units.
 */
export function formatAmountForPayPal(amount: number, currencyCode: string) {
  const exponent = getCurrencyExponent(currencyCode)
  return Number(amount || 0).toFixed(exponent)
}
