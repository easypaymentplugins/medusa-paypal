import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260201090000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "paypal_webhook_event" (
        "id" text NOT NULL,
        "event_id" text NOT NULL,
        "event_type" text NOT NULL,
        "resource_id" text NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "paypal_webhook_event_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "paypal_webhook_event_event_id_unique" UNIQUE ("event_id")
      );

      CREATE INDEX IF NOT EXISTS "idx_paypal_webhook_event_deleted_at"
        ON "paypal_webhook_event" ("deleted_at");
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      DROP TABLE IF EXISTS "paypal_webhook_event" CASCADE;
    `)
  }
}
