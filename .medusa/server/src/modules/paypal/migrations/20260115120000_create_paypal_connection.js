"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Migration20260115120000 = void 0;
const migrations_1 = require("@medusajs/framework/mikro-orm/migrations");
class Migration20260115120000 extends migrations_1.Migration {
    async up() {
        this.addSql(`
      CREATE TABLE IF NOT EXISTS "paypal_connection" (
        "id" text NOT NULL,
        "environment" text NOT NULL DEFAULT 'sandbox',
        "status" text NOT NULL DEFAULT 'disconnected',
        "shared_id" text NULL,
        "auth_code" text NULL,
        "seller_client_id" text NULL,
        "seller_client_secret" text NULL,
        "app_access_token" text NULL,
        "app_access_token_expires_at" timestamptz NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "paypal_connection_pkey" PRIMARY KEY ("id")
      );

      CREATE INDEX IF NOT EXISTS "idx_paypal_connection_deleted_at"
        ON "paypal_connection" ("deleted_at");
    `);
    }
    async down() {
        this.addSql(`
      DROP TABLE IF EXISTS "paypal_connection" CASCADE;
    `);
    }
}
exports.Migration20260115120000 = Migration20260115120000;
//# sourceMappingURL=20260115120000_create_paypal_connection.js.map