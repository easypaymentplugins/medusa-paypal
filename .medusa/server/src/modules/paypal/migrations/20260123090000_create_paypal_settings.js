"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Migration20260123090000 = void 0;
const migrations_1 = require("@medusajs/framework/mikro-orm/migrations");
class Migration20260123090000 extends migrations_1.Migration {
    async up() {
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
    `);
    }
    async down() {
        this.addSql(`DROP TABLE IF EXISTS "paypal_settings" CASCADE;`);
    }
}
exports.Migration20260123090000 = Migration20260123090000;
//# sourceMappingURL=20260123090000_create_paypal_settings.js.map