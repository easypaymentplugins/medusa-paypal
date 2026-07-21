"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Migration20261101090000 = void 0;
const migrations_1 = require("@medusajs/framework/mikro-orm/migrations");
class Migration20261101090000 extends migrations_1.Migration {
    async up() {
        this.addSql(`
      DELETE FROM "paypal_metric"
      WHERE "name" = 'reconcile_status';

      DROP TABLE IF EXISTS "paypal_reconciliation_status" CASCADE;
    `);
    }
    async down() {
        this.addSql(`
      CREATE TABLE IF NOT EXISTS "paypal_reconciliation_status" (
        "id" text NOT NULL,
        "status" text NOT NULL,
        "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "paypal_reconciliation_status_pkey" PRIMARY KEY ("id")
      );
    `);
    }
}
exports.Migration20261101090000 = Migration20261101090000;
//# sourceMappingURL=20261101090000_remove_paypal_reconciliation_status.js.map