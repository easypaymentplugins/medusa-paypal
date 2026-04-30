import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261201090000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DROP TABLE IF EXISTS "paypal_audit_log" CASCADE;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "paypal_audit_log" (
        "id" text NOT NULL,
        "event_type" text NOT NULL,
        "metadata" jsonb NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "paypal_audit_log_pkey" PRIMARY KEY ("id")
      );

      CREATE INDEX IF NOT EXISTS "idx_paypal_audit_log_deleted_at"
        ON "paypal_audit_log" ("deleted_at");
    `)
  }
}
