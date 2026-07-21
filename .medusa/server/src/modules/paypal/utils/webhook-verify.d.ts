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
export declare function rawBodyToString(rawBody: unknown): string | null;
/**
 * Compose the JSON request body for `verify-webhook-signature`.
 *
 * `fields` are the transmission headers + webhook_id; `webhookEventJson` is the
 * raw webhook body verbatim (preferred) or a serialized fallback. Undefined /
 * null header values are omitted. The webhook event is concatenated as raw JSON
 * (not re-encoded) so the bytes PayPal hashes match what it signed.
 */
export declare function composeVerifyRequestBody(fields: Record<string, string | undefined | null>, webhookEventJson: string): string;
/**
 * Pick the bytes to use for `webhook_event`: the raw body when present and
 * non-blank, otherwise a JSON serialization of the parsed body.
 */
export declare function resolveWebhookEventJson(rawBody: string | null | undefined, parsedBody: unknown): string;
//# sourceMappingURL=webhook-verify.d.ts.map