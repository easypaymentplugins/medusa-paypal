import { Migration } from "@mikro-orm/migrations"

export class Migration20270101090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "paypal_connection" alter column "environment" set default 'live';`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "paypal_connection" alter column "environment" set default 'sandbox';`)
  }
}
