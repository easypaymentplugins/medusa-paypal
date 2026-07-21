"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Migration20260201090000 = void 0;
const migrations_1 = require("@medusajs/framework/mikro-orm/migrations");
class Migration20260201090000 extends migrations_1.Migration {
    async up() {
        this.addSql(`
      CREATE TABLE IF NOT EXISTS "paypal_webhook_event" (
        "id" text NOT NULL,
        "event_id" text NOT NULL,
        "event_type" text NOT NULL,
        "resource_id" text NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "paypal_webhook_event_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "paypal_webhook_event_event_id_unique" UNIQUE ("event_id")
      );

      CREATE INDEX IF NOT EXISTS "idx_paypal_webhook_event_deleted_at"
        ON "paypal_webhook_event" ("deleted_at");
    `);
    }
    async down() {
        this.addSql(`
      DROP TABLE IF EXISTS "paypal_webhook_event" CASCADE;
    `);
    }
}
exports.Migration20260201090000 = Migration20260201090000;
//# sourceMappingURL=20260201090000_create_paypal_webhook_event.js.map