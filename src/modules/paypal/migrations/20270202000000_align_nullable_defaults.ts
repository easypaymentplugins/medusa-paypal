import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20270202000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE IF EXISTS "paypal_connection" ALTER COLUMN "metadata" DROP NOT NULL;`
    )
    this.addSql(
      `ALTER TABLE IF EXISTS "paypal_webhook_event" ALTER COLUMN "payload" DROP NOT NULL;`
    )
    this.addSql(
      `ALTER TABLE IF EXISTS "paypal_metric" ALTER COLUMN "data" DROP NOT NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "idx_paypal_connection_status" ON "paypal_connection" ("status", "created_at" DESC);`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "idx_paypal_webhook_event_type" ON "paypal_webhook_event" ("event_type");`
    )
  }

  async down(): Promise<void> {
    this.addSql(
      `UPDATE "paypal_connection" SET "metadata" = '{}'::jsonb WHERE "metadata" IS NULL;`
    )
    this.addSql(
      `ALTER TABLE IF EXISTS "paypal_connection" ALTER COLUMN "metadata" SET NOT NULL;`
    )
    this.addSql(
      `UPDATE "paypal_webhook_event" SET "payload" = '{}'::jsonb WHERE "payload" IS NULL;`
    )
    this.addSql(
      `ALTER TABLE IF EXISTS "paypal_webhook_event" ALTER COLUMN "payload" SET NOT NULL;`
    )
    this.addSql(
      `UPDATE "paypal_metric" SET "data" = '{}'::jsonb WHERE "data" IS NULL;`
    )
    this.addSql(
      `ALTER TABLE IF EXISTS "paypal_metric" ALTER COLUMN "data" SET NOT NULL;`
    )
    this.addSql(`DROP INDEX IF EXISTS "idx_paypal_connection_status";`)
    this.addSql(`DROP INDEX IF EXISTS "idx_paypal_webhook_event_type";`)
  }
}
