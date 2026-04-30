import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261101090000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      DELETE FROM "paypal_metric"
      WHERE "name" = 'reconcile_status';

      DROP TABLE IF EXISTS "paypal_reconciliation_status" CASCADE;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "paypal_reconciliation_status" (
        "id" text NOT NULL,
        "status" text NOT NULL,
        "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "paypal_reconciliation_status_pkey" PRIMARY KEY ("id")
      );
    `)
  }
}
