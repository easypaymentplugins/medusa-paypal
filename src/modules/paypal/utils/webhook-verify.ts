/**
 * Helpers for calling PayPal's `verify-webhook-signature` API correctly.
 *
 * PayPal computes the expected signature over the EXACT bytes it transmitted.
 * Re-serializing the parsed body (`JSON.stringify(req.body)`) can change those
 * bytes — key ordering, non-ASCII escaping (`José` vs `José`), number and
 * whitespace formatting — which makes verification intermittently return
 * FAILURE for legitimate webhooks. When the original raw body is available we
 * inject it verbatim as `webhook_event`; otherwise we fall back to serializing
 * the parsed body so behavior never regresses.
 */

/** Normalize Medusa's `req.rawBody` (a Buffer when `preserveRawBody` is set) to a string. */
export function rawBodyToString(rawBody: unknown): string | null {
  if (rawBody == null) {
    return null
  }
  if (typeof rawBody === "string") {
    return rawBody.length > 0 ? rawBody : null
  }
  if (Buffer.isBuffer(rawBody)) {
    return rawBody.length > 0 ? rawBody.toString("utf8") : null
  }
  if (rawBody instanceof Uint8Array) {
    return rawBody.length > 0 ? Buffer.from(rawBody).toString("utf8") : null
  }
  return null
}

/**
 * Compose the JSON request body for `verify-webhook-signature`.
 *
 * `fields` are the transmission headers + webhook_id; `webhookEventJson` is the
 * raw webhook body verbatim (preferred) or a serialized fallback. Undefined /
 * null header values are omitted. The webhook event is concatenated as raw JSON
 * (not re-encoded) so the bytes PayPal hashes match what it signed.
 */
export function composeVerifyRequestBody(
  fields: Record<string, string | undefined | null>,
  webhookEventJson: string
): string {
  const head = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`)
    .join(",")
  return `{${head}${head ? "," : ""}"webhook_event":${webhookEventJson}}`
}

/**
 * Pick the bytes to use for `webhook_event`: the raw body when present and
 * non-blank, otherwise a JSON serialization of the parsed body.
 */
export function resolveWebhookEventJson(
  rawBody: string | null | undefined,
  parsedBody: unknown
): string {
  if (typeof rawBody === "string" && rawBody.trim().length > 0) {
    return rawBody
  }
  return JSON.stringify(parsedBody ?? {})
}
