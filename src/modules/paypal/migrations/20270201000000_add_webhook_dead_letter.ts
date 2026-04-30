import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20270201000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_paypal_webhook_event_status_retry"
        ON "paypal_webhook_event" ("status", "next_retry_at")
        WHERE "status" = 'failed';
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      DROP INDEX IF EXISTS "idx_paypal_webhook_event_status_retry";
    `)
  }
}
