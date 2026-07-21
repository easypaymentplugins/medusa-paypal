"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Migration20270103090000 = void 0;
const migrations_1 = require("@medusajs/framework/mikro-orm/migrations");
class Migration20270103090000 extends migrations_1.Migration {
    async up() {
        this.addSql(`alter table if exists "paypal_connection" add column if not exists "seller_merchant_id" text null;`);
    }
    async down() {
        this.addSql(`alter table if exists "paypal_connection" drop column if exists "seller_merchant_id";`);
    }
}
exports.Migration20270103090000 = Migration20270103090000;
//# sourceMappingURL=20270103090000_add_paypal_seller_merchant_id.js.map