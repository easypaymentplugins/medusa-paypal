"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Migration20260401090000 = void 0;
const migrations_1 = require("@medusajs/framework/mikro-orm/migrations");
class Migration20260401090000 extends migrations_1.Migration {
    async up() {
        this.addSql(`
      CREATE TABLE IF NOT EXISTS "paypal_metric" (
        "id" text NOT NULL,
        "name" text NOT NULL,
        "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "paypal_metric_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "paypal_metric_name_unique" UNIQUE ("name")
      );

      CREATE INDEX IF NOT EXISTS "idx_paypal_metric_deleted_at"
        ON "paypal_metric" ("deleted_at");
    `);
    }
    async down() {
        this.addSql(`
      DROP TABLE IF EXISTS "paypal_metric" CASCADE;
    `);
    }
}
exports.Migration20260401090000 = Migration20260401090000;
//# sourceMappingURL=20260401090000_create_paypal_metric.js.map