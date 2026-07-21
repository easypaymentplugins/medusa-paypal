"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Migration20270101090000 = void 0;
const migrations_1 = require("@medusajs/framework/mikro-orm/migrations");
class Migration20270101090000 extends migrations_1.Migration {
    async up() {
        this.addSql(`alter table if exists "paypal_connection" alter column "environment" set default 'live';`);
    }
    async down() {
        this.addSql(`alter table if exists "paypal_connection" alter column "environment" set default 'sandbox';`);
    }
}
exports.Migration20270101090000 = Migration20270101090000;
//# sourceMappingURL=20270101090000_set_paypal_environment_default_live.js.map