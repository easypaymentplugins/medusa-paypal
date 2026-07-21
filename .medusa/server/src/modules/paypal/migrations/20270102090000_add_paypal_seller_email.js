"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Migration20270102090000 = void 0;
const migrations_1 = require("@medusajs/framework/mikro-orm/migrations");
class Migration20270102090000 extends migrations_1.Migration {
    async up() {
        this.addSql(`alter table if exists "paypal_connection" add column if not exists "seller_email" text null;`);
    }
    async down() {
        this.addSql(`alter table if exists "paypal_connection" drop column if exists "seller_email";`);
    }
}
exports.Migration20270102090000 = Migration20270102090000;
//# sourceMappingURL=20270102090000_add_paypal_seller_email.js.map