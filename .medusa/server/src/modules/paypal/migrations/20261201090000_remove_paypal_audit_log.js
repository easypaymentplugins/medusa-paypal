"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Migration20261201090000 = void 0;
const migrations_1 = require("@medusajs/framework/mikro-orm/migrations");
class Migration20261201090000 extends migrations_1.Migration {
    async up() {
        this.addSql(`
      DROP TABLE IF EXISTS "paypal_audit_log" CASCADE;
    `);
    }
    async down() {
        this.addSql(`
      CREATE TABLE IF NOT EXISTS "paypal_audit_log" (
        "id" text NOT NULL,
        "event_type" text NOT NULL,
        "metadata" jsonb NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "paypal_audit_log_pkey" PRIMARY KEY ("id")
      );

      CREATE INDEX IF NOT EXISTS "idx_paypal_audit_log_deleted_at"
        ON "paypal_audit_log" ("deleted_at");
    `);
    }
}
exports.Migration20261201090000 = Migration20261201090000;
//# sourceMappingURL=20261201090000_remove_paypal_audit_log.js.map