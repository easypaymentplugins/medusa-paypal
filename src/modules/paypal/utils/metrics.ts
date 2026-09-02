/**
 * Atomic metric upsert shared by the credential resolver (payment-module
 * container) and the PayPal module service (application container).
 *
 * The `count` increment happens inside a single SQL statement (not read in JS
 * then written back), and the unique constraint on `name` drives the ON
 * CONFLICT — so concurrent captures/refunds/webhooks can never lose metric
 * updates to a read-modify-write race. Any provided metadata is merged first,
 * then `count`/`last_recorded_at` are applied last so metadata can't clobber
 * the running count.
 *
 * Never throws: metrics must not break the payment flow. `db` is a knex
 * connection (Medusa's `__pg_connection__`).
 */
export async function recordMetricAtomic(
  db: { raw: (sql: string, bindings: unknown[]) => Promise<unknown> },
  name: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const id = `ppmet_${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}`
    const nowIso = new Date().toISOString()
    const metaJson = JSON.stringify(metadata || {})

    await db.raw(
      `INSERT INTO paypal_metric (id, name, data, created_at, updated_at)
       VALUES (
         ?, ?,
         (?::jsonb || jsonb_build_object('count', 1, 'last_recorded_at', ?::text)),
         now(), now()
       )
       ON CONFLICT (name) DO UPDATE SET
         data = paypal_metric.data
                || ?::jsonb
                || jsonb_build_object(
                     'count', COALESCE((paypal_metric.data->>'count')::bigint, 0) + 1,
                     'last_recorded_at', ?::text
                   ),
         deleted_at = NULL,
         updated_at = now()`,
      [id, name, metaJson, nowIso, metaJson, nowIso]
    )
  } catch {
    // metrics must never break the payment flow
  }
}
