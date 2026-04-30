import { Migration } from "@mikro-orm/migrations"

export class Migration20270102090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "paypal_connection" add column if not exists "seller_email" text null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "paypal_connection" drop column if exists "seller_email";`)
  }
}
