import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260123090000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "paypal_settings" (
        "id" text NOT NULL,
        "data" jsonb NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "paypal_settings_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "idx_paypal_settings_deleted_at"
        ON "paypal_settings" ("deleted_at");
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "paypal_settings" CASCADE;`)
  }
}
