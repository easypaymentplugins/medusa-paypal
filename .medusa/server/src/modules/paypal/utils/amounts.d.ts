export declare function getCurrencyExponent(currencyCode: string): 0 | 2 | 3;
/**
 * Coerce a Medusa monetary amount into a plain JS number.
 *
 * Medusa passes amounts to payment providers as a `BigNumberInput`, which can be
 * a plain `number`/`string`, a `BigNumber` instance (exposing a `numeric`
 * getter), or the serialized raw form `{ value, precision }`. A naive
 * `Number(amount)` returns `NaN` for the object forms — which silently turns a
 * partial refund/capture into a full one and produces a `…-NaN` idempotency key.
 */
export declare function toAmountNumber(amount: unknown): number;
/**
 * Format a Medusa amount for the PayPal REST API.
 *
 * Medusa passes monetary amounts to payment providers in MAJOR units
 * (e.g. `10` for €10.00), and PayPal's Orders/Payments API also expects major
 * units as a string (e.g. `"10.00"`). So this only fixes the decimal precision
 * for the currency — it must NOT divide/convert to minor units.
 */
export declare function formatAmountForPayPal(amount: number, currencyCode: string): string;
//# sourceMappingURL=amounts.d.ts.map