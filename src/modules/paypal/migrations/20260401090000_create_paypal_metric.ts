import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260401090000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "paypal_metric" (
        "id" text NOT NULL,
        "name" text NOT NULL,
        "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "paypal_metric_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "paypal_metric_name_unique" UNIQUE ("name")
      );

      CREATE INDEX IF NOT EXISTS "idx_paypal_metric_deleted_at"
        ON "paypal_metric" ("deleted_at");
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      DROP TABLE IF EXISTS "paypal_metric" CASCADE;
    `)
  }
}
