"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayPalCredentialResolver = void 0;
const metrics_1 = require("./metrics");
const partner_1 = require("./partner");
const paypal_fetch_1 = require("./paypal-fetch");
const secret_crypto_1 = require("./secret-crypto");
const TOKEN_MARGIN_MS = 2 * 60 * 1000;
/**
 * Self-contained credential and token management for PayPal payment providers.
 *
 * Payment providers in Medusa v2 run inside the payment module's scoped
 * container, which is isolated from the application container where the
 * PayPal module service lives. This resolver bypasses the container boundary
 * entirely by reading credentials directly from the database via pgConnection
 * (knex), which Medusa injects into every module container.
 *
 * Same source of truth (paypal_connection / paypal_settings tables), zero
 * cross-container dependencies.
 */
class PayPalCredentialResolver {
    db;
    tokenRefreshPromise = null;
    constructor(pgConnection) {
        this.db = pgConnection;
    }
    async getConnectionRow() {
        // Match the module service's soft-delete semantics: this raw knex read
        // bypasses MikroORM's automatic deleted_at filter, so apply it explicitly
        // or a soft-deleted connection's credentials would keep being used.
        const rows = await this.db("paypal_connection")
            .select("*")
            .whereNull("deleted_at")
            .orderBy("created_at", "desc")
            .limit(1);
        return rows?.[0] ?? null;
    }
    /**
     * Resolve the amount an admin actually requested for a capture.
     *
     * Medusa does NOT pass the requested capture amount to the provider — only
     * `context.idempotency_key`, which is the Medusa `capture` row id. Without
     * this lookup the provider can only capture the full session amount, which
     * over-charges the buyer on partial captures. Returns null when the id
     * doesn't resolve (caller falls back to the session amount).
     */
    async getRequestedCaptureAmount(captureRowId) {
        try {
            if (!captureRowId || typeof captureRowId !== "string")
                return null;
            const rows = await this.db("capture")
                .select("amount", "raw_amount")
                .where("id", captureRowId)
                .whereNull("deleted_at")
                .limit(1);
            const row = rows?.[0];
            if (!row)
                return null;
            const raw = row.raw_amount;
            if (raw && typeof raw === "object" && raw.value !== undefined) {
                const v = Number(raw.value);
                if (Number.isFinite(v) && v > 0)
                    return v;
            }
            const v = Number(row.amount);
            return Number.isFinite(v) && v > 0 ? v : null;
        }
        catch {
            return null;
        }
    }
    getEnvCreds(row, env) {
        const meta = (row?.metadata || {});
        const creds = meta?.credentials?.[env] || {};
        return {
            clientId: creds.client_id || creds.clientId || undefined,
            clientSecret: (0, secret_crypto_1.decryptSecret)(creds.client_secret || creds.clientSecret) || undefined,
        };
    }
    async getActiveCredentials() {
        const row = await this.getConnectionRow();
        if (!row) {
            throw new Error("PayPal connection not found. Please complete onboarding in the admin panel.");
        }
        const env = row.environment === "sandbox" ? "sandbox" : "live";
        const c = this.getEnvCreds(row, env);
        if (!c.clientId || !c.clientSecret) {
            throw new Error(`PayPal credentials missing for environment "${env}". Please save credentials in the admin panel.`);
        }
        return {
            environment: env,
            client_id: c.clientId,
            client_secret: c.clientSecret,
        };
    }
    async getAccessToken() {
        const creds = await this.getActiveCredentials();
        const base = creds.environment === "live"
            ? "https://api-m.paypal.com"
            : "https://api-m.sandbox.paypal.com";
        const row = await this.getConnectionRow();
        if (row?.app_access_token && row.app_access_token_expires_at) {
            const expiresAt = new Date(row.app_access_token_expires_at);
            if (expiresAt.getTime() - Date.now() > TOKEN_MARGIN_MS) {
                return {
                    accessToken: (0, secret_crypto_1.decryptSecret)(row.app_access_token),
                    base,
                };
            }
        }
        if (this.tokenRefreshPromise) {
            const accessToken = await this.tokenRefreshPromise;
            return { accessToken, base };
        }
        this.tokenRefreshPromise = this.refreshAccessToken(row, creds).finally(() => {
            this.tokenRefreshPromise = null;
        });
        const accessToken = await this.tokenRefreshPromise;
        return { accessToken, base };
    }
    async refreshAccessToken(row, creds) {
        const base = creds.environment === "live"
            ? "https://api-m.paypal.com"
            : "https://api-m.sandbox.paypal.com";
        const basic = Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString("base64");
        const body = new URLSearchParams();
        body.set("grant_type", "client_credentials");
        const res = await (0, paypal_fetch_1.paypalFetch)(`${base}/v1/oauth2/token`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization: `Basic ${basic}`,
                "PayPal-Partner-Attribution-Id": partner_1.PAYPAL_PARTNER_ATTRIBUTION_ID,
            },
            body,
            signal: AbortSignal.timeout(30_000),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(`PayPal client_credentials failed (${res.status}): ${JSON.stringify(json)}`);
        }
        const accessToken = String(json.access_token || "");
        if (!accessToken) {
            throw new Error("PayPal client_credentials succeeded but access_token is missing.");
        }
        const expiresIn = Number(json.expires_in || 3600);
        const newExpiresAt = new Date(Date.now() + expiresIn * 1000);
        if (row?.id) {
            await this.db("paypal_connection").where("id", row.id).update({
                app_access_token: (0, secret_crypto_1.encryptSecret)(accessToken),
                app_access_token_expires_at: newExpiresAt,
                updated_at: new Date(),
            });
        }
        return accessToken;
    }
    async getSettings() {
        try {
            // Deterministic singleton read (oldest row wins) — must match the module
            // service's getSettings ordering so both containers agree on the same
            // row even if a first-boot race ever created a duplicate.
            const rows = await this.db("paypal_settings")
                .select("data")
                .whereNull("deleted_at")
                .orderBy("created_at", "asc")
                .limit(1);
            const data = (rows?.[0]?.data || {});
            return {
                additionalSettings: (data.additional_settings || {}),
                advancedCardSettings: (data.advanced_card_payments || {}),
                apiDetails: (data.api_details || {}),
            };
        }
        catch {
            return {
                additionalSettings: {},
                advancedCardSettings: {},
                apiDetails: {},
            };
        }
    }
    async recordAuditEvent(eventType, metadata) {
        try {
            console.info(JSON.stringify({
                log: "paypal_audit",
                event_type: eventType,
                at: new Date().toISOString(),
                ...(metadata ? { metadata } : {}),
            }));
        }
        catch {
            // audit logging must never break the payment flow
        }
    }
    async recordMetric(name, metadata) {
        // Atomic upsert (single INSERT ... ON CONFLICT statement) so concurrent
        // captures/refunds don't lose metric updates via a read-modify-write race.
        await (0, metrics_1.recordMetricAtomic)(this.db, name, metadata);
    }
}
exports.PayPalCredentialResolver = PayPalCredentialResolver;
//# sourceMappingURL=credential-resolver.js.map