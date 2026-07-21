import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20270301000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "idx_paypal_webhook_event_transmission_id" ON "paypal_webhook_event" ("transmission_id") WHERE "transmission_id" IS NOT NULL;`
    )
  }

  async down(): Promise<void> {
    this.addSql(
      `DROP INDEX IF EXISTS "idx_paypal_webhook_event_transmission_id";`
    )
  }
}
