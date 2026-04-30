const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
])

const THREE_DECIMAL_CURRENCIES = new Set(["BHD", "JOD", "KWD", "OMR", "TND"])

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

export function formatAmountForPayPal(
  minorAmount: number,
  currencyCode: string
) {
  const exponent = getCurrencyExponent(currencyCode)
  const factor = 10 ** exponent
  const majorAmount = Number(minorAmount || 0) / factor
  return majorAmount.toFixed(exponent)
}
