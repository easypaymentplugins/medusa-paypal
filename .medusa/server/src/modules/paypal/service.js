"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("@medusajs/framework/utils");
const paypal_fetch_1 = require("./utils/paypal-fetch");
const secret_crypto_1 = require("./utils/secret-crypto");
const paypal_connection_1 = __importDefault(require("./models/paypal_connection"));
const paypal_metric_1 = __importDefault(require("./models/paypal_metric"));
const paypal_settings_1 = __importDefault(require("./models/paypal_settings"));
const paypal_webhook_event_1 = __importDefault(require("./models/paypal_webhook_event"));
const config_1 = require("./types/config");
const currencies_1 = require("./utils/currencies");
const SENSITIVE_KEY_RE = /secret|password|client_secret|access_token|refresh_token|authorization|auth_code|api[_-]?key/i;
/**
 * Defensive redaction for audit logs: replace values of keys that look
 * sensitive with "[REDACTED]". Bounded depth/breadth so a pathological payload
 * can't blow up logging.
 */
function redactSensitive(value, depth = 0) {
    if (depth > 6 || value === null || typeof value !== "object") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.slice(0, 50).map((v) => redactSensitive(v, depth + 1));
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        out[k] = SENSITIVE_KEY_RE.test(k) ? "[REDACTED]" : redactSensitive(v, depth + 1);
    }
    return out;
}
class PayPalModuleService extends (0, utils_1.MedusaService)({
    PayPalConnection: paypal_connection_1.default,
    PayPalMetric: paypal_metric_1.default,
    PayPalSettings: paypal_settings_1.default,
    PayPalWebhookEvent: paypal_webhook_event_1.default,
}) {
    cfg = (0, config_1.getPayPalConfig)();
    tokenRefreshPromise = null;
    get bnCode() {
        return this.cfg.bnCode || "MBJTechnolabs_SI_SPB";
    }
    async getSettingsData() {
        const settings = await this.getSettings();
        return (settings?.data || {});
    }
    async ensureSettingsDefaults() {
        const data = await this.getSettingsData();
        const onboarding = { ...(data.onboarding_config || {}) };
        const apiDetails = { ...(data.api_details || {}) };
        let changed = false;
        if (!onboarding.partner_service_url) {
            onboarding.partner_service_url = this.cfg.partnerServiceUrl;
            changed = true;
        }
        if (!onboarding.partner_js_url) {
            onboarding.partner_js_url = this.cfg.partnerJsUrl;
            changed = true;
        }
        if (!onboarding.backend_url) {
            onboarding.backend_url = this.cfg.backendUrl;
            changed = true;
        }
        if (!onboarding.seller_nonce) {
            onboarding.seller_nonce = this.cfg.sellerNonce;
            changed = true;
        }
        if (!onboarding.bn_code && this.cfg.bnCode) {
            onboarding.bn_code = this.cfg.bnCode;
            changed = true;
        }
        if (!onboarding.partner_merchant_id_sandbox) {
            onboarding.partner_merchant_id_sandbox = this.cfg.partnerMerchantIdSandbox;
            changed = true;
        }
        if (!onboarding.partner_merchant_id_live) {
            onboarding.partner_merchant_id_live = this.cfg.partnerMerchantIdLive;
            changed = true;
        }
        if (!apiDetails.currency_code) {
            const raw = (process.env.PAYPAL_CURRENCY || "").trim();
            apiDetails.currency_code = raw ? (0, currencies_1.normalizeCurrencyCode)(raw) : "EUR";
            changed = true;
        }
        if (!apiDetails.storefront_url) {
            const storeUrl = process.env.STOREFRONT_URL || process.env.STORE_URL;
            if (storeUrl) {
                apiDetails.storefront_url = storeUrl;
                changed = true;
            }
        }
        if (changed) {
            await this.saveSettings({
                onboarding_config: onboarding,
                api_details: apiDetails,
            });
        }
        return { onboarding, apiDetails };
    }
    async getApiDetails() {
        const { onboarding, apiDetails } = await this.ensureSettingsDefaults();
        return {
            onboarding,
            apiDetails,
        };
    }
    getAlertWebhookUrls() {
        return (this.cfg.alertWebhookUrls || []).map((url) => url.trim()).filter(Boolean);
    }
    async getPartnerMerchantId(env) {
        const { onboarding } = await this.ensureSettingsDefaults();
        return env === "live" ? onboarding.partner_merchant_id_live : onboarding.partner_merchant_id_sandbox;
    }
    async getCurrentRow() {
        const rows = await this.listPayPalConnections({}, { take: 1, order: { created_at: "DESC" } });
        return rows?.[0] ?? null;
    }
    async getCurrentEnvironment() {
        try {
            const row = await this.getCurrentRow();
            const env = row?.environment || "live";
            return env === "sandbox" ? "sandbox" : "live";
        }
        catch {
            return "live";
        }
    }
    getEnvCreds(row, env) {
        const meta = (row?.metadata || {});
        const creds = meta?.credentials?.[env] || {};
        return {
            clientId: creds.client_id || creds.clientId || undefined,
            // Secrets are encrypted at rest when PAYPAL_ENCRYPTION_KEY is set; decrypt
            // here so every consumer (auth, status) sees plaintext. Legacy plaintext
            // values pass through unchanged.
            clientSecret: (0, secret_crypto_1.decryptSecret)(creds.client_secret || creds.clientSecret) || undefined,
            sellerMerchantId: creds.seller_merchant_id ||
                creds.sellerMerchantId ||
                creds.payer_id ||
                creds.merchant_id ||
                creds.merchantId ||
                undefined,
            sellerEmail: creds.seller_email || creds.sellerEmail || undefined,
        };
    }
    extractSellerEmail(...candidates) {
        const queue = [...candidates];
        const seen = new WeakSet();
        const MAX_ITERATIONS = 500;
        let iterations = 0;
        while (queue.length > 0 && iterations < MAX_ITERATIONS) {
            iterations++;
            const value = queue.shift();
            if (!value) {
                continue;
            }
            if (typeof value === "string") {
                const trimmed = value.trim();
                if (trimmed && trimmed.includes("@")) {
                    return trimmed;
                }
                continue;
            }
            if (typeof value !== "object") {
                continue;
            }
            if (seen.has(value)) {
                continue;
            }
            seen.add(value);
            if (Array.isArray(value)) {
                queue.push(...value);
                continue;
            }
            const obj = value;
            const prioritized = [
                obj.email,
                obj.primary_email,
                obj.merchant_email,
                obj.email_address,
                obj.account_email,
                obj.contact_email,
                obj.value,
                obj.address,
            ];
            queue.push(...prioritized);
            for (const [k, v] of Object.entries(obj)) {
                const key = String(k).toLowerCase();
                if (key.includes("email") || key.includes("address")) {
                    queue.push(v);
                }
            }
            queue.push(...Object.values(obj));
        }
        return null;
    }
    async fetchMerchantIntegrationDetails(env, merchantId, accessTokenOverride) {
        const partnerMerchantId = await this.getPartnerMerchantId(env);
        if (!partnerMerchantId) {
            throw new Error("Missing PayPal partner merchant id configuration.");
        }
        const baseUrl = env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
        const accessToken = accessTokenOverride ?? await this.getAppAccessToken();
        const resp = await (0, paypal_fetch_1.paypalFetch)(`${baseUrl}/v1/customer/partners/${encodeURIComponent(partnerMerchantId)}/merchant-integrations/${encodeURIComponent(merchantId)}`, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
                "PayPal-Partner-Attribution-Id": this.bnCode,
            },
        });
        const text = await resp.text().catch(() => "");
        let json = {};
        try {
            json = text ? JSON.parse(text) : {};
        }
        catch (e) {
            console.warn("[PayPal] Failed to parse response JSON — using empty object:", e?.message);
        }
        if (!resp.ok) {
            throw new Error(`PayPal merchant integration lookup failed (${resp.status}): ${text || JSON.stringify(json)}`);
        }
        return json;
    }
    async getAppAccessTokenForCredentials(env, credentials) {
        const baseUrl = env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
        const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64");
        const body = new URLSearchParams();
        body.set("grant_type", "client_credentials");
        const res = await (0, paypal_fetch_1.paypalFetch)(`${baseUrl}/v1/oauth2/token`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization: `Basic ${basic}`,
                "PayPal-Partner-Attribution-Id": this.bnCode,
            },
            body,
        });
        const text = await res.text().catch(() => "");
        let json = {};
        try {
            json = text ? JSON.parse(text) : {};
        }
        catch (e) {
            console.warn("[PayPal] Failed to parse app token response JSON:", e?.message);
        }
        if (!res.ok) {
            throw new Error(`PayPal client_credentials failed (${res.status}): ${text || JSON.stringify(json)}`);
        }
        const accessToken = String(json.access_token || "");
        if (!accessToken) {
            throw new Error("PayPal client_credentials succeeded but access_token is missing.");
        }
        return { accessToken, tokenPayload: json };
    }
    async fetchSellerProfileFromDirectCredentials(env, credentials) {
        const baseUrl = env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
        const partnerMerchantId = await this.getPartnerMerchantId(env);
        let tokenPayload = null;
        let accessToken = "";
        if (credentials) {
            const tokenResp = await this.getAppAccessTokenForCredentials(env, {
                clientId: credentials.clientId,
                clientSecret: credentials.clientSecret,
            });
            accessToken = tokenResp.accessToken;
            tokenPayload = tokenResp.tokenPayload;
        }
        else {
            accessToken = await this.getAppAccessToken();
        }
        let sellerEmail = this.extractSellerEmail(tokenPayload || undefined);
        let sellerMerchantId = String(tokenPayload?.merchant_id || tokenPayload?.payer_id || tokenPayload?.account_id || "").trim() || null;
        try {
            const userInfoResp = await (0, paypal_fetch_1.paypalFetch)(`${baseUrl}/v1/identity/oauth2/userinfo?schema=paypalv1`, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    "PayPal-Partner-Attribution-Id": this.bnCode,
                },
            });
            if (userInfoResp.ok) {
                const userInfo = await userInfoResp.json().catch(() => ({}));
                sellerEmail = sellerEmail || this.extractSellerEmail(userInfo);
                sellerMerchantId =
                    sellerMerchantId ||
                        String(userInfo?.merchant_id || userInfo?.payer_id || userInfo?.user_id || userInfo?.sub || "").trim() ||
                        null;
            }
        }
        catch (e) {
            console.warn("[PayPal] userinfo lookup failed:", e?.message || e);
        }
        if (partnerMerchantId) {
            try {
                const credsResp = await (0, paypal_fetch_1.paypalFetch)(`${baseUrl}/v1/customer/partners/${encodeURIComponent(partnerMerchantId)}/merchant-integrations/credentials/`, {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "Content-Type": "application/json",
                        "PayPal-Partner-Attribution-Id": this.bnCode,
                    },
                });
                if (credsResp.ok) {
                    const credsJson = await credsResp.json().catch(() => ({}));
                    sellerEmail = sellerEmail || this.extractSellerEmail(credsJson);
                    sellerMerchantId = sellerMerchantId || String(credsJson?.merchant_id || "").trim() || null;
                }
            }
            catch (e) {
                console.warn("[PayPal] direct credential profile lookup failed:", e?.message || e);
            }
        }
        const hydrated = await this.hydrateSellerMetadataFromCredentials(env, {
            accessToken,
            sellerMerchantId,
            sellerEmail,
        });
        return {
            sellerMerchantId: hydrated.sellerMerchantId,
            sellerEmail: hydrated.sellerEmail,
        };
    }
    async hydrateSellerMetadataFromCredentials(env, input) {
        let sellerMerchantId = (input.sellerMerchantId || "").trim() || null;
        let sellerEmail = (input.sellerEmail || "").trim() || null;
        if (!sellerEmail && input.metadataCandidates?.length) {
            sellerEmail = this.extractSellerEmail(...input.metadataCandidates);
        }
        if (sellerMerchantId && !sellerEmail) {
            try {
                const details = await this.fetchMerchantIntegrationDetails(env, sellerMerchantId, input.accessToken);
                sellerEmail = this.extractSellerEmail(details);
            }
            catch (e) {
                console.warn("[PayPal] merchant integration lookup failed:", e?.message || e);
            }
        }
        return { sellerMerchantId, sellerEmail };
    }
    async syncRowFieldsFromMetadata(row, env) {
        const c = this.getEnvCreds(row, env);
        await this.updatePayPalConnections({
            id: row.id,
            status: c.clientId && c.clientSecret ? "connected" : "disconnected",
            seller_client_id: c.clientId || null,
            // c.clientSecret is decrypted (from getEnvCreds); re-encrypt for the column.
            seller_client_secret: (0, secret_crypto_1.encryptSecret)(c.clientSecret) || null,
            seller_merchant_id: c.sellerMerchantId || null,
            seller_email: c.sellerEmail || null,
            metadata: {
                ...(row.metadata || {}),
                active_environment: env,
            },
        });
    }
    async setEnvironment(env) {
        const nextEnv = env === "sandbox" ? "sandbox" : "live";
        const row = await this.getCurrentRow();
        const previousEnv = row?.environment || "live";
        if (!row) {
            const created = await this.createPayPalConnections({
                environment: nextEnv,
                status: "disconnected",
                shared_id: null,
                auth_code: null,
                seller_client_id: null,
                seller_client_secret: null,
                seller_merchant_id: null,
                seller_email: null,
                app_access_token: null,
                app_access_token_expires_at: null,
                metadata: { credentials: {}, active_environment: nextEnv },
            });
            await this.recordAuditEvent("environment_switched", {
                previous_environment: previousEnv,
                environment: nextEnv,
            });
            return created;
        }
        await this.updatePayPalConnections({
            id: row.id,
            environment: nextEnv,
            app_access_token: null,
            app_access_token_expires_at: null,
            metadata: {
                ...(row.metadata || {}),
                active_environment: nextEnv,
            },
        });
        const updated = await this.getCurrentRow();
        if (updated) {
            await this.syncRowFieldsFromMetadata(updated, nextEnv);
        }
        await this.recordAuditEvent("environment_switched", {
            previous_environment: previousEnv,
            environment: nextEnv,
        });
        return await this.getCurrentRow();
    }
    async createOnboardingLink(input) {
        const { onboarding } = await this.ensureSettingsDefaults();
        // Honor an explicit environment from the caller so the generated link can't
        // depend on a racing "set environment" request having landed first.
        const env = input?.env === "sandbox" || input?.env === "live"
            ? input.env
            : await this.getCurrentEnvironment();
        // The popup lands here after onboarding, as a plain top-level navigation with
        // no auth token — so it must be the PUBLIC store bridge route, not an
        // /admin/* route (which would 401 and leave the popup stuck). The bridge
        // exchanges the auth code for seller credentials server-side, relays the
        // result to the opener, and closes the popup. We pin the environment in the
        // URL so the bridge saves credentials under the correct env even though
        // PayPal's redirect carries no auth/session.
        // Use the /hooks namespace: Medusa's publishable-key middleware rejects
        // unauthenticated top-level navigations to /store/* routes, so the popup
        // would land on a NOT_ALLOWED error page instead of the bridge.
        const return_url = `${String(onboarding.backend_url || "").replace(/\/$/, "")}/hooks/paypal/onboard-return?env=${env}`;
        const partner_merchant_id = await this.getPartnerMerchantId(env);
        const email = (input?.email || "").trim();
        if (!partner_merchant_id) {
            throw new Error("Missing PAYPAL_PARTNER_MERCHANT_ID_* env for current environment");
        }
        const form = new URLSearchParams();
        if (email) {
            form.set("email", email);
        }
        form.set("sandbox", env === "live" ? "no" : "yes");
        form.set("return_url", return_url);
        form.set("return_url_description", "Return to your shop.");
        form.set("partner_merchant_id", partner_merchant_id);
        form.set("from", "medusa");
        const products = input?.products?.length ? input.products : ["PPCP"];
        products.forEach((p) => {
            form.append("products[]", p);
        });
        const res = await (0, paypal_fetch_1.paypalFetch)(onboarding.partner_service_url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: form.toString(),
        });
        const text = await res.text().catch(() => "");
        if (!res.ok) {
            throw new Error(`Onboarding service failed (${res.status}): ${text}`);
        }
        const trimmed = text.trim();
        if (trimmed.startsWith("http")) {
            return { onboarding_url: trimmed, return_url };
        }
        let json;
        try {
            json = JSON.parse(trimmed);
        }
        catch {
            throw new Error(`Invalid onboarding link response (not JSON / URL): ${trimmed.slice(0, 200)}`);
        }
        if (json?.body) {
            const inner = typeof json.body === "string" ? json.body.trim() : json.body;
            if (typeof inner === "string" && inner.startsWith("http")) {
                return { onboarding_url: inner, return_url };
            }
            try {
                json = typeof inner === "string" ? JSON.parse(inner) : inner;
            }
            catch {
                throw new Error(`Onboarding wrapper JSON 'body' is not valid JSON / URL: ${typeof inner === "string" ? inner.slice(0, 200) : "[object]"}`);
            }
        }
        if (json?.name && json?.message && (json?.debug_id || json?.details || json?.links)) {
            const debug = json.debug_id ? ` debug_id=${json.debug_id}` : "";
            const details = Array.isArray(json.details)
                ? json.details
                    .slice(0, 3)
                    .map((d) => {
                    const issue = d?.issue ? String(d.issue) : "";
                    const desc = d?.description ? String(d.description) : "";
                    const field = d?.field ? String(d.field) : "";
                    return [issue, desc, field].filter(Boolean).join(" | ");
                })
                    .filter(Boolean)
                    .join("; ")
                : "";
            throw new Error(`PayPal onboarding error: ${json.name}: ${json.message}.${debug}${details ? ` Details: ${details}` : ""}`);
        }
        if (json?.onboarding_url && String(json.onboarding_url).startsWith("http")) {
            return { onboarding_url: String(json.onboarding_url), return_url };
        }
        const links = Array.isArray(json?.links) ? json.links : null;
        if (links) {
            const action = links.find((l) => l?.rel === "action_url" || l?.rel === "actionUrl" || l?.rel === "action-url");
            const href = action?.href ? String(action.href) : null;
            if (href && href.startsWith("http")) {
                return { onboarding_url: href, return_url };
            }
        }
        throw new Error(`Onboarding JSON missing action_url link. Keys: ${Object.keys(json || {}).join(", ")}`);
    }
    async startOnboarding() {
        const row = await this.getCurrentRow();
        const env = await this.getCurrentEnvironment();
        if (row) {
            await this.updatePayPalConnections({ id: row.id, status: "pending" });
            return;
        }
        await this.createPayPalConnections({
            environment: env,
            status: "pending",
            metadata: {},
        });
    }
    async saveOnboardCallback(input) {
        const row = await this.getCurrentRow();
        const env = await this.getCurrentEnvironment();
        if (!row) {
            return await this.createPayPalConnections({
                environment: env,
                status: "pending_credentials",
                auth_code: input.authCode,
                shared_id: input.sharedId,
                metadata: {},
            });
        }
        return await this.updatePayPalConnections({
            id: row.id,
            status: "pending_credentials",
            auth_code: input.authCode,
            shared_id: input.sharedId,
        });
    }
    async exchangeAndSaveSellerCredentials(input) {
        const env = (input.env || (await this.getCurrentEnvironment()));
        // Onboarding completion can now arrive via several redundant paths
        // (partner.js's onboardingCallback in the opener, the return_url bridge that
        // runs inside the popup, and admin status polling). PayPal's authorization
        // code is single-use, so a second exchange of the same code would fail with
        // invalid_grant. If we already exchanged this exact code and hold seller
        // credentials for this environment, treat the duplicate as a success no-op.
        const existingRow = await this.getCurrentRow();
        if (existingRow && existingRow.auth_code === input.authCode) {
            const existingCreds = this.getEnvCreds(existingRow, env);
            if (existingCreds.clientId && existingCreds.clientSecret) {
                return;
            }
        }
        await this.saveOnboardCallback({ authCode: input.authCode, sharedId: input.sharedId });
        const baseUrl = env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
        const { onboarding } = await this.ensureSettingsDefaults();
        const sellerNonce = (onboarding.seller_nonce || "").trim();
        if (!sellerNonce) {
            throw new Error("PayPal seller nonce is not configured. Set PAYPAL_SELLER_NONCE.");
        }
        const tokenBody = new URLSearchParams();
        tokenBody.set("grant_type", "authorization_code");
        tokenBody.set("code", input.authCode);
        tokenBody.set("code_verifier", sellerNonce);
        const basic = Buffer.from(`${input.sharedId}:`).toString("base64");
        const tokenRes = await (0, paypal_fetch_1.paypalFetch)(`${baseUrl}/v1/oauth2/token`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization: `Basic ${basic}`,
                "PayPal-Partner-Attribution-Id": this.bnCode,
            },
            body: tokenBody,
        });
        const tokenText = await tokenRes.text().catch(() => "");
        let tokenJson = {};
        try {
            tokenJson = tokenText ? JSON.parse(tokenText) : {};
        }
        catch (e) {
            console.warn("[PayPal] Failed to parse token response JSON:", e?.message);
        }
        if (!tokenRes.ok) {
            // Two redundant completion paths can race to exchange the same single-use
            // code; the loser gets invalid_grant. If credentials were saved in the
            // meantime (the other path won), the onboarding actually succeeded.
            const racedRow = await this.getCurrentRow();
            if (racedRow) {
                const racedCreds = this.getEnvCreds(racedRow, env);
                if (racedCreds.clientId && racedCreds.clientSecret) {
                    return;
                }
            }
            throw new Error(`PayPal authorization_code token exchange failed (${tokenRes.status}): ${tokenText || JSON.stringify(tokenJson)}`);
        }
        const sellerAccessToken = String(tokenJson.access_token || "");
        if (!sellerAccessToken) {
            throw new Error("PayPal token exchange succeeded but access_token is missing.");
        }
        const partnerMerchantId = await this.getPartnerMerchantId(env);
        if (!partnerMerchantId) {
            throw new Error("Missing PayPal partner merchant id configuration.");
        }
        const credRes = await (0, paypal_fetch_1.paypalFetch)(`${baseUrl}/v1/customer/partners/${encodeURIComponent(partnerMerchantId)}/merchant-integrations/credentials/`, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${sellerAccessToken}`,
                "PayPal-Partner-Attribution-Id": this.bnCode,
            },
        });
        const credText = await credRes.text().catch(() => "");
        let credJson = {};
        try {
            credJson = credText ? JSON.parse(credText) : {};
        }
        catch (e) {
            console.warn("[PayPal] Failed to parse token response JSON:", e?.message);
        }
        if (!credRes.ok) {
            throw new Error(`PayPal credentials fetch failed (${credRes.status}): ${credText || JSON.stringify(credJson)}`);
        }
        const clientId = String(credJson.client_id || credJson.clientId || "");
        const clientSecret = String(credJson.client_secret || credJson.clientSecret || "");
        if (!clientId || !clientSecret) {
            throw new Error(`PayPal credentials response missing client_id/client_secret. Keys: ${Object.keys(credJson || {}).join(", ")}`);
        }
        let sellerEmail = this.extractSellerEmail(credJson, tokenJson);
        let sellerMerchantId = String(credJson.payer_id || credJson.merchant_id || tokenJson.payer_id || tokenJson.merchant_id || "").trim() ||
            null;
        if (!sellerEmail) {
            const merchantCandidates = [
                String(credJson.payer_id || "").trim(),
                String(credJson.merchant_id || "").trim(),
                String(tokenJson.payer_id || "").trim(),
                String(tokenJson.merchant_id || "").trim(),
            ].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i);
            for (const merchantId of merchantCandidates) {
                try {
                    const merchantDetails = await this.fetchMerchantIntegrationDetails(env, merchantId, sellerAccessToken);
                    sellerMerchantId = sellerMerchantId || merchantId;
                    sellerEmail = this.extractSellerEmail(merchantDetails);
                    if (sellerEmail) {
                        break;
                    }
                }
                catch (e) {
                    console.warn(`[PayPal] Merchant integration lookup for ${merchantId} failed:`, e?.message || e);
                }
            }
        }
        await this.saveSellerCredentials({
            clientId,
            clientSecret,
            sellerMerchantId,
            sellerEmail,
        });
        if (!sellerEmail && sellerMerchantId) {
            try {
                const appAccessToken = await this.getAppAccessToken();
                const details = await this.fetchMerchantIntegrationDetails(env, sellerMerchantId, appAccessToken);
                sellerEmail = this.extractSellerEmail(details);
                if (sellerEmail) {
                    await this.saveSellerCredentials({ clientId, clientSecret, sellerMerchantId, sellerEmail });
                }
            }
            catch (e) {
                console.warn("[PayPal] Post-save merchant_id email lookup failed:", e?.message || e);
            }
        }
    }
    async saveSellerCredentials(input) {
        const row = await this.getCurrentRow();
        const currentEnv = await this.getCurrentEnvironment();
        const env = (input.environment || currentEnv);
        const existingCreds = row ? this.getEnvCreds(row, env) : {};
        const nextSellerMerchantId = (input.sellerMerchantId || "").trim() || existingCreds.sellerMerchantId || row?.seller_merchant_id || null;
        const nextSellerEmail = (input.sellerEmail || "").trim() || existingCreds.sellerEmail || row?.seller_email || null;
        // Encrypt once and store the same ciphertext in both the metadata copy and
        // the denormalized column (no-op when encryption is disabled).
        const storedClientSecret = (0, secret_crypto_1.encryptSecret)(input.clientSecret);
        const nextCreds = {
            client_id: input.clientId,
            client_secret: storedClientSecret,
            merchant_id: nextSellerMerchantId,
            seller_merchant_id: nextSellerMerchantId,
            seller_email: nextSellerEmail,
        };
        if (!row) {
            const created = await this.createPayPalConnections({
                environment: env,
                status: "connected",
                seller_client_id: input.clientId,
                seller_client_secret: storedClientSecret,
                seller_merchant_id: nextSellerMerchantId,
                seller_email: nextSellerEmail,
                app_access_token: null,
                app_access_token_expires_at: null,
                metadata: {
                    credentials: {
                        [env]: nextCreds,
                    },
                    active_environment: env,
                },
            });
            await this.recordAuditEvent("credentials_saved", {
                environment: env,
                client_id: input.clientId,
            });
            await this.ensureWebhookRegistration();
            return created;
        }
        const meta = (row.metadata || {});
        const creds = { ...(meta.credentials || {}) };
        creds[env] = {
            ...(creds[env] || {}),
            ...nextCreds,
        };
        const updated = await this.updatePayPalConnections({
            id: row.id,
            status: "connected",
            seller_client_id: input.clientId,
            seller_client_secret: storedClientSecret,
            seller_merchant_id: nextSellerMerchantId,
            seller_email: nextSellerEmail,
            app_access_token: null,
            app_access_token_expires_at: null,
            metadata: {
                ...(row.metadata || {}),
                credentials: creds,
                active_environment: env,
            },
        });
        await this.recordAuditEvent("credentials_saved", {
            environment: env,
            client_id: input.clientId,
        });
        await this.ensureWebhookRegistration();
        return updated;
    }
    async saveAndHydrateSellerCredentials(input) {
        const env = (input.environment || (await this.getCurrentEnvironment()));
        await this.saveSellerCredentials({
            clientId: input.clientId,
            clientSecret: input.clientSecret,
            environment: env,
        });
        try {
            const hydrated = await this.fetchSellerProfileFromDirectCredentials(env, {
                clientId: input.clientId,
                clientSecret: input.clientSecret,
            });
            if (hydrated.sellerEmail || hydrated.sellerMerchantId) {
                await this.saveSellerCredentials({
                    clientId: input.clientId,
                    clientSecret: input.clientSecret,
                    sellerMerchantId: hydrated.sellerMerchantId,
                    sellerEmail: hydrated.sellerEmail,
                    environment: env,
                });
            }
            const refreshedRow = await this.getCurrentRow();
            if (refreshedRow) {
                await this.syncRowFieldsFromMetadata(refreshedRow, env);
            }
        }
        catch (e) {
            console.warn("[PayPal] saveAndHydrateSellerCredentials lookup failed:", e?.message || e);
        }
        // This is a write context (credentials were just saved), so it is allowed to
        // backfill the seller profile if it is still missing.
        return await this.getStatus(env, { hydrateMissingProfile: true });
    }
    async resolveWebhookUrl() {
        const { onboarding } = await this.ensureSettingsDefaults();
        const base = String(onboarding.backend_url || "").replace(/\/$/, "");
        if (!base) {
            throw new Error("PayPal backend URL is not configured.");
        }
        // The /hooks namespace has no publishable-key guard. PayPal cannot send
        // Medusa's x-publishable-api-key header, so a webhook registered at the
        // old /store/paypal/webhook path is rejected before the handler runs.
        return `${base}/hooks/paypal/webhook`;
    }
    /** Legacy webhook path (blocked by Medusa's store publishable-key guard). */
    async resolveLegacyWebhookUrl() {
        const { onboarding } = await this.ensureSettingsDefaults();
        const base = String(onboarding.backend_url || "").replace(/\/$/, "");
        if (!base)
            return "";
        return `${base}/store/paypal/webhook`;
    }
    isLocalWebhookUrl(url) {
        try {
            const parsed = new URL(url);
            return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
        }
        catch {
            return false;
        }
    }
    // Only probe PayPal for a stale legacy webhook URL once per process per
    // environment — this runs on admin status reads and must stay cheap.
    webhookUrlMigrationChecked = {};
    webhookHealScheduled = {};
    async migrateLegacyWebhookUrl(env, webhookId) {
        if (this.webhookUrlMigrationChecked[env])
            return;
        this.webhookUrlMigrationChecked[env] = true;
        const newUrl = await this.resolveWebhookUrl().catch(() => "");
        const legacyUrl = await this.resolveLegacyWebhookUrl();
        if (!newUrl || !legacyUrl || this.isLocalWebhookUrl(newUrl))
            return;
        const accessToken = await this.getAppAccessToken();
        const baseUrl = env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
        const getResp = await (0, paypal_fetch_1.paypalFetch)(`${baseUrl}/v1/notifications/webhooks/${encodeURIComponent(webhookId)}`, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "PayPal-Partner-Attribution-Id": this.bnCode,
            },
        });
        const getJson = await getResp.json().catch(() => ({}));
        if (!getResp.ok)
            return;
        const currentUrl = String(getJson?.url || "");
        if (currentUrl !== legacyUrl)
            return;
        const patchResp = await (0, paypal_fetch_1.paypalFetch)(`${baseUrl}/v1/notifications/webhooks/${encodeURIComponent(webhookId)}`, {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "PayPal-Partner-Attribution-Id": this.bnCode,
            },
            body: JSON.stringify([
                { op: "replace", path: "/url", value: newUrl },
            ]),
        });
        if (patchResp.ok) {
            await this.recordAuditEvent("webhook_url_migrated", {
                environment: env,
                webhook_id: webhookId,
                from: legacyUrl,
                to: newUrl,
            });
            console.info(`[PayPal] migrated webhook ${webhookId} URL from ${legacyUrl} to ${newUrl}`);
        }
    }
    async ensureWebhookRegistration() {
        const env = await this.getCurrentEnvironment();
        const { apiDetails } = await this.ensureSettingsDefaults();
        const webhookIds = { ...(apiDetails.webhook_ids || {}) };
        if (webhookIds[env]) {
            // Existing installs registered the webhook at /store/paypal/webhook,
            // which Medusa's publishable-key middleware blocks for external callers.
            // Migrate the registered URL to /hooks/paypal/webhook in place
            // (best-effort — a failure keeps the stored id and current behavior).
            await this.migrateLegacyWebhookUrl(env, webhookIds[env]).catch((e) => {
                console.warn("[PayPal] webhook URL migration check failed:", e?.message || e);
            });
            return webhookIds[env];
        }
        const accessToken = await this.getAppAccessToken();
        const baseUrl = env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
        const webhookUrl = await this.resolveWebhookUrl();
        if (this.isLocalWebhookUrl(webhookUrl)) {
            await this.recordAuditEvent("webhook_skipped_localhost", {
                environment: env,
                webhook_url: webhookUrl,
            });
            return webhookIds[env] || "";
        }
        const listResp = await (0, paypal_fetch_1.paypalFetch)(`${baseUrl}/v1/notifications/webhooks`, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "PayPal-Partner-Attribution-Id": this.bnCode,
            },
        });
        const listJson = await listResp.json().catch(() => ({}));
        if (!listResp.ok) {
            throw new Error(`PayPal webhook list failed (${listResp.status}): ${JSON.stringify(listJson)}`);
        }
        const existing = Array.isArray(listJson?.webhooks)
            ? listJson.webhooks.find((hook) => hook?.url === webhookUrl)
            : null;
        let webhookId = existing?.id ? String(existing.id) : "";
        if (!webhookId) {
            const createResp = await (0, paypal_fetch_1.paypalFetch)(`${baseUrl}/v1/notifications/webhooks`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                    "PayPal-Partner-Attribution-Id": this.bnCode,
                },
                body: JSON.stringify({
                    url: webhookUrl,
                    event_types: [
                        { name: "CHECKOUT.ORDER.APPROVED" },
                        { name: "CHECKOUT.ORDER.CANCELLED" },
                        { name: "PAYMENT.CAPTURE.COMPLETED" },
                        { name: "PAYMENT.CAPTURE.DENIED" },
                        { name: "PAYMENT.CAPTURE.REFUNDED" },
                        { name: "PAYMENT.CAPTURE.REVERSED" },
                        { name: "PAYMENT.AUTHORIZATION.CREATED" },
                        { name: "PAYMENT.AUTHORIZATION.VOIDED" },
                        { name: "PAYMENT.AUTHORIZATION.DENIED" },
                        { name: "PAYMENT.REFUND.COMPLETED" },
                        { name: "PAYMENT.REFUND.DENIED" },
                    ],
                }),
            });
            const createJson = await createResp.json().catch(() => ({}));
            if (!createResp.ok) {
                throw new Error(`PayPal webhook create failed (${createResp.status}): ${JSON.stringify(createJson)}`);
            }
            webhookId = String(createJson?.id || "");
        }
        if (!webhookId) {
            throw new Error("PayPal webhook registration did not return an id");
        }
        const nextWebhookIds = { ...webhookIds, [env]: webhookId };
        await this.saveSettings({
            api_details: {
                ...apiDetails,
                webhook_ids: nextWebhookIds,
            },
        });
        await this.recordAuditEvent("webhook_registered", {
            environment: env,
            webhook_id: webhookId,
            webhook_url: webhookUrl,
        });
        return webhookId;
    }
    maskValue(value, visibleChars = 4) {
        if (!value)
            return null;
        const trimmed = String(value);
        if (trimmed.length <= visibleChars) {
            return "•".repeat(trimmed.length);
        }
        return `${"•".repeat(Math.max(0, trimmed.length - visibleChars))}${trimmed.slice(-visibleChars)}`;
    }
    /**
     * Report the current connection status.
     *
     * `hydrateMissingProfile` is opt-in and OFF by default: status is read on
     * `GET /admin/paypal/status` (and other read-only routes), where it must be a
     * safe, side-effect-free read. The seller-profile backfill makes an outbound
     * PayPal call and persists to the DB, so it only runs from write contexts
     * (e.g. saving credentials) that explicitly request it.
     */
    async getStatus(envOverride, opts = {}) {
        const row = await this.getCurrentRow();
        const env = envOverride ?? (await this.getCurrentEnvironment());
        if (!row) {
            return { environment: env, status: "disconnected", seller_client_id_present: false };
        }
        const c = this.getEnvCreds(row, env);
        const hasCreds = !!(c.clientId && c.clientSecret);
        let sellerEmail = c.sellerEmail || row.seller_email || null;
        let sellerMerchantId = c.sellerMerchantId || row.seller_merchant_id || null;
        // Self-heal the webhook registration for already-connected merchants:
        // installs that registered the webhook at the old (blocked)
        // /store/paypal/webhook path get migrated to /hooks/paypal/webhook the
        // first time an admin views the status page after upgrading. Fire and
        // forget — status reads must never block on PayPal, and the migration is
        // throttled to once per process per environment internally.
        if (hasCreds && !this.webhookHealScheduled[env]) {
            this.webhookHealScheduled[env] = true;
            void this.ensureWebhookRegistration().catch((e) => {
                console.warn("[PayPal] webhook self-heal failed:", e?.message || e);
            });
        }
        if (!sellerEmail && hasCreds && opts.hydrateMissingProfile) {
            try {
                const hydrated = await this.fetchSellerProfileFromDirectCredentials(env);
                if (hydrated.sellerEmail || hydrated.sellerMerchantId) {
                    await this.saveSellerCredentials({
                        clientId: c.clientId,
                        clientSecret: c.clientSecret,
                        sellerMerchantId: hydrated.sellerMerchantId || sellerMerchantId,
                        sellerEmail: hydrated.sellerEmail || sellerEmail,
                        environment: env,
                    });
                    const refreshedRow = await this.getCurrentRow();
                    if (refreshedRow) {
                        const refreshedCreds = this.getEnvCreds(refreshedRow, env);
                        sellerEmail = refreshedCreds.sellerEmail || refreshedRow.seller_email || sellerEmail;
                        sellerMerchantId =
                            refreshedCreds.sellerMerchantId || refreshedRow.seller_merchant_id || sellerMerchantId;
                    }
                }
            }
            catch (e) {
                console.warn("[PayPal] status direct credential lookup failed:", e?.message || e);
            }
        }
        return {
            environment: env,
            status: (hasCreds ? "connected" : "disconnected"),
            shared_id: row.shared_id ?? null,
            auth_code: row.auth_code ? "***stored***" : null,
            seller_client_id_present: hasCreds,
            seller_client_id_masked: this.maskValue(c.clientId),
            seller_client_secret_masked: c.clientSecret ? "••••••••" : null,
            seller_merchant_id: sellerMerchantId,
            seller_email: sellerEmail,
            updated_at: row.updated_at?.toISOString?.() ?? null,
        };
    }
    async disconnect() {
        const row = await this.getCurrentRow();
        if (!row)
            return;
        const env = await this.getCurrentEnvironment();
        const meta = (row.metadata || {});
        const creds = { ...(meta.credentials || {}) };
        delete creds[env];
        const hasAnyCreds = Object.values(creds).some((v) => {
            return v && typeof v === "object" && v.client_id && v.client_secret;
        });
        await this.updatePayPalConnections({
            id: row.id,
            status: hasAnyCreds ? "connected" : "disconnected",
            shared_id: null,
            auth_code: null,
            seller_client_id: null,
            seller_client_secret: null,
            seller_merchant_id: null,
            seller_email: null,
            app_access_token: null,
            app_access_token_expires_at: null,
            metadata: {
                ...(row.metadata || {}),
                credentials: creds,
                active_environment: env,
            },
        });
        const updated = await this.getCurrentRow();
        if (updated) {
            await this.syncRowFieldsFromMetadata(updated, env);
        }
        await this.recordAuditEvent("disconnected", { environment: env });
    }
    async getAppAccessToken() {
        const row = await this.getCurrentRow();
        if (!row) {
            throw new Error("PayPal connection row not found. Please complete onboarding.");
        }
        const expiresAt = row.app_access_token_expires_at ? new Date(row.app_access_token_expires_at) : null;
        if (row.app_access_token && expiresAt) {
            const msLeft = expiresAt.getTime() - Date.now();
            // Token is encrypted at rest when a key is configured; decrypt the cached
            // value (legacy plaintext passes through unchanged).
            if (msLeft > 2 * 60 * 1000)
                return (0, secret_crypto_1.decryptSecret)(row.app_access_token);
        }
        if (this.tokenRefreshPromise) {
            return this.tokenRefreshPromise;
        }
        this.tokenRefreshPromise = this.refreshAccessToken(row).finally(() => {
            this.tokenRefreshPromise = null;
        });
        return this.tokenRefreshPromise;
    }
    async refreshAccessToken(row) {
        const env = await this.getCurrentEnvironment();
        const creds = await this.getActiveCredentials();
        const baseUrl = env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
        const basic = Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString("base64");
        const body = new URLSearchParams();
        body.set("grant_type", "client_credentials");
        const res = await (0, paypal_fetch_1.paypalFetch)(`${baseUrl}/v1/oauth2/token`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization: `Basic ${basic}`,
                "PayPal-Partner-Attribution-Id": this.bnCode,
            },
            body,
            signal: AbortSignal.timeout(30_000),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok)
            throw new Error(`PayPal client_credentials failed (${res.status}): ${JSON.stringify(json)}`);
        const accessToken = String(json.access_token || "");
        if (!accessToken) {
            throw new Error("PayPal client_credentials succeeded but access_token is missing.");
        }
        const expiresIn = Number(json.expires_in || 3600);
        const newExpiresAt = new Date(Date.now() + expiresIn * 1000);
        await this.updatePayPalConnections({
            id: row.id,
            app_access_token: (0, secret_crypto_1.encryptSecret)(accessToken),
            app_access_token_expires_at: newExpiresAt,
        });
        return accessToken;
    }
    async generateClientToken(opts) {
        const env = await this.getCurrentEnvironment();
        const baseUrl = env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
        const accessToken = await this.getAppAccessToken();
        const res = await (0, paypal_fetch_1.paypalFetch)(`${baseUrl}/v1/identity/generate-token`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                Accept: "application/json",
                "PayPal-Partner-Attribution-Id": this.bnCode,
                ...(opts?.locale ? { "Accept-Language": opts.locale } : {}),
            },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(`PayPal generate-token failed (${res.status}): ${JSON.stringify(json)}`);
        }
        const token = String(json?.client_token || "");
        if (!token) {
            throw new Error("PayPal client_token is missing in generate-token response");
        }
        return token;
    }
    async getSettings() {
        const rows = await this.listPayPalSettings({}, { take: 1 });
        const row = rows?.[0];
        return { data: (row?.data || {}) };
    }
    deepMerge(target, source) {
        const result = { ...target };
        for (const key of Object.keys(source)) {
            const sv = source[key];
            const tv = target[key];
            if (sv !== null &&
                typeof sv === "object" &&
                !Array.isArray(sv) &&
                tv !== null &&
                typeof tv === "object" &&
                !Array.isArray(tv)) {
                result[key] = this.deepMerge(tv, sv);
            }
            else {
                result[key] = sv;
            }
        }
        return result;
    }
    async saveSettings(patch) {
        const rows = await this.listPayPalSettings({}, { take: 1 });
        const row = rows?.[0];
        const current = (row?.data || {});
        const next = this.deepMerge(current, patch);
        if (!row) {
            const created = await this.createPayPalSettings({ data: next });
            return { data: (created.data || {}) };
        }
        await this.updatePayPalSettings({ id: row.id, data: next });
        return { data: next };
    }
    async getActiveCredentials() {
        const row = await this.getCurrentRow();
        const env = await this.getCurrentEnvironment();
        if (!row) {
            throw new Error("PayPal connection row not found. Please complete onboarding.");
        }
        const c = this.getEnvCreds(row, env);
        const clientSecret = c.clientSecret || "";
        if (!c.clientId || !clientSecret) {
            throw new Error(`PayPal credentials missing for environment "${env}". Please save credentials.`);
        }
        return {
            environment: env,
            client_id: c.clientId,
            client_secret: clientSecret,
        };
    }
    async getOrderDetails(orderId) {
        if (!orderId) {
            throw new Error("PayPal orderId is required");
        }
        const env = await this.getCurrentEnvironment();
        const base = env === "live"
            ? "https://api-m.paypal.com"
            : "https://api-m.sandbox.paypal.com";
        const accessToken = await this.getAppAccessToken();
        const resp = await (0, paypal_fetch_1.paypalFetch)(`${base}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "PayPal-Partner-Attribution-Id": this.bnCode,
            },
            signal: AbortSignal.timeout(30_000),
        });
        const text = await resp.text();
        if (!resp.ok) {
            throw new Error(`PayPal get order error (${resp.status}): ${text}`);
        }
        return JSON.parse(text);
    }
    async createWebhookEventRecord(input) {
        try {
            const created = await this.createPayPalWebhookEvents({
                event_id: input.event_id,
                event_type: input.event_type,
                resource_id: input.resource_id ?? null,
                payload: input.payload ?? {},
                event_version: input.event_version ?? null,
                transmission_id: input.transmission_id ?? null,
                transmission_time: input.transmission_time ?? null,
                status: input.status ?? "pending",
                attempt_count: input.attempt_count ?? 0,
                next_retry_at: null,
                processed_at: null,
                last_error: null,
            });
            return { created: true, event: created };
        }
        catch (error) {
            const message = String(error?.message || "");
            const code = String(error?.code || "");
            if (message.includes("paypal_webhook_event_event_id_unique") ||
                code === "23505" ||
                (message.includes("unique") && message.includes("event_id"))) {
                const existing = await this.listPayPalWebhookEvents({ event_id: input.event_id });
                return { created: false, event: existing?.[0] ?? null };
            }
            throw error;
        }
    }
    async updateWebhookEventRecord(input) {
        return await this.updatePayPalWebhookEvents({
            id: input.id,
            status: input.status,
            attempt_count: input.attempt_count,
            next_retry_at: input.next_retry_at ?? null,
            processed_at: input.processed_at ?? null,
            last_error: input.last_error ?? null,
            resource_id: input.resource_id ?? null,
        });
    }
    /**
     * Emit an audit event as a single structured log line.
     *
     * The dedicated audit-log table was removed; for high-volume/containerized
     * deployments the audit trail lives in aggregated stdout logs. This records a
     * greppable `paypal_audit` line (filter on `"log":"paypal_audit"`) with
     * sensitive keys redacted. It never throws — audit logging must not break the
     * caller's payment flow.
     */
    async recordAuditEvent(eventType, metadata) {
        try {
            console.info(JSON.stringify({
                log: "paypal_audit",
                event_type: eventType,
                at: new Date().toISOString(),
                ...(metadata ? { metadata: redactSensitive(metadata) } : {}),
            }));
        }
        catch {
            // never let audit logging interfere with the payment flow
        }
        return null;
    }
    async recordMetric(name, metadata) {
        try {
            const existing = await this.listPayPalMetrics({ name });
            const row = existing?.[0];
            const current = (row?.data || {});
            const next = {
                ...current,
                ...(metadata || {}),
                count: Number(current.count || 0) + 1,
                last_recorded_at: new Date().toISOString(),
            };
            if (!row) {
                try {
                    return await this.createPayPalMetrics({ name, data: next });
                }
                catch {
                    const retry = await this.listPayPalMetrics({ name });
                    const retryRow = retry?.[0];
                    if (retryRow) {
                        const retryData = (retryRow.data || {});
                        return await this.updatePayPalMetrics({
                            id: retryRow.id,
                            name,
                            data: {
                                ...retryData,
                                ...(metadata || {}),
                                count: Number(retryData.count || 0) + 1,
                                last_recorded_at: new Date().toISOString(),
                            },
                        });
                    }
                    throw new Error(`Failed to record metric "${name}"`);
                }
            }
            return await this.updatePayPalMetrics({ id: row.id, name, data: next });
        }
        catch (e) {
            console.warn("[PayPal] recordMetric failed:", e instanceof Error ? e.message : e);
            return null;
        }
    }
    async recordPaymentLog(eventType, metadata) {
        return await this.recordAuditEvent(`payment_${eventType}`, metadata);
    }
    async sendAlert(input) {
        const urls = this.getAlertWebhookUrls();
        if (urls.length === 0) {
            return;
        }
        const payload = {
            type: input.type,
            message: input.message,
            metadata: input.metadata ?? {},
            source: "paypal",
            timestamp: new Date().toISOString(),
        };
        await Promise.all(urls.map(async (url) => {
            try {
                const resp = await (0, paypal_fetch_1.paypalFetch)(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(payload),
                });
                if (!resp.ok) {
                    const text = await resp.text().catch(() => "");
                    await this.recordAuditEvent("alert_failed", {
                        url,
                        status: resp.status,
                        response: text,
                    });
                }
                else {
                    await this.recordAuditEvent("alert_sent", { url, type: input.type });
                }
            }
            catch (error) {
                await this.recordAuditEvent("alert_failed", {
                    url,
                    message: error?.message,
                });
            }
        }));
    }
}
exports.default = PayPalModuleService;
//# sourceMappingURL=service.js.map