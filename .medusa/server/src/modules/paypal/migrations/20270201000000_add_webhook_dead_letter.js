"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Migration20270201000000 = void 0;
const migrations_1 = require("@medusajs/framework/mikro-orm/migrations");
class Migration20270201000000 extends migrations_1.Migration {
    async up() {
        this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_paypal_webhook_event_status_retry"
        ON "paypal_webhook_event" ("status", "next_retry_at")
        WHERE "status" = 'failed';
    `);
    }
    async down() {
        this.addSql(`
      DROP INDEX IF EXISTS "idx_paypal_webhook_event_status_retry";
    `);
    }
}
exports.Migration20270201000000 = Migration20270201000000;
//# sourceMappingURL=20270201000000_add_webhook_dead_letter.js.map