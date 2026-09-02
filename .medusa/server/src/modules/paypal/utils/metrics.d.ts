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
export declare function recordMetricAtomic(db: {
    raw: (sql: string, bindings: unknown[]) => Promise<unknown>;
}, name: string, metadata?: Record<string, unknown>): Promise<void>;
//# sourceMappingURL=metrics.d.ts.map