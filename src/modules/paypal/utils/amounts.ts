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
 * Coerce a Medusa monetary amount into a plain JS number.
 *
 * Medusa passes amounts to payment providers as a `BigNumberInput`, which can be
 * a plain `number`/`string`, a `BigNumber` instance (exposing a `numeric`
 * getter), or the serialized raw form `{ value, precision }`. A naive
 * `Number(amount)` returns `NaN` for the object forms — which silently turns a
 * partial refund/capture into a full one and produces a `…-NaN` idempotency key.
 */
export function toAmountNumber(amount: unknown): number {
  if (amount === null || amount === undefined) {
    return 0
  }
  if (typeof amount === "number") {
    return Number.isFinite(amount) ? amount : 0
  }
  if (typeof amount === "string") {
    const parsed = Number(amount)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (typeof amount === "object") {
    const obj = amount as Record<string, unknown>
    // Medusa BigNumber instance.
    if (typeof obj.numeric === "number" && Number.isFinite(obj.numeric)) {
      return obj.numeric
    }
    // Serialized raw form: { value: "20", precision: 20 }.
    if (obj.value !== undefined && obj.value !== null) {
      const parsed = Number(obj.value)
      return Number.isFinite(parsed) ? parsed : 0
    }
  }
  const fallback = Number(amount as never)
  return Number.isFinite(fallback) ? fallback : 0
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
