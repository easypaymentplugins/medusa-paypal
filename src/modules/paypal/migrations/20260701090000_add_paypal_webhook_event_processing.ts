import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260701090000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "paypal_webhook_event"
        ADD COLUMN IF NOT EXISTS "event_version" text NULL,
        ADD COLUMN IF NOT EXISTS "transmission_id" text NULL,
        ADD COLUMN IF NOT EXISTS "transmission_time" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS "attempt_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "next_retry_at" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "processed_at" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "last_error" text NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "paypal_webhook_event"
        DROP COLUMN IF EXISTS "event_version",
        DROP COLUMN IF EXISTS "transmission_id",
        DROP COLUMN IF EXISTS "transmission_time",
        DROP COLUMN IF EXISTS "status",
        DROP COLUMN IF EXISTS "attempt_count",
        DROP COLUMN IF EXISTS "next_retry_at",
        DROP COLUMN IF EXISTS "processed_at",
        DROP COLUMN IF EXISTS "last_error";
    `)
  }
}
