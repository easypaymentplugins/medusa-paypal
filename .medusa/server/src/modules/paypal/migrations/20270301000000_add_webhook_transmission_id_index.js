"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Migration20270301000000 = void 0;
const migrations_1 = require("@medusajs/framework/mikro-orm/migrations");
class Migration20270301000000 extends migrations_1.Migration {
    async up() {
        this.addSql(`CREATE INDEX IF NOT EXISTS "idx_paypal_webhook_event_transmission_id" ON "paypal_webhook_event" ("transmission_id") WHERE "transmission_id" IS NOT NULL;`);
    }
    async down() {
        this.addSql(`DROP INDEX IF EXISTS "idx_paypal_webhook_event_transmission_id";`);
    }
}
exports.Migration20270301000000 = Migration20270301000000;
//# sourceMappingURL=20270301000000_add_webhook_transmission_id_index.js.map