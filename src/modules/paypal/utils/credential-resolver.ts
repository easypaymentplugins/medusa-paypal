import { paypalFetch } from "./paypal-fetch"
import { decryptSecret, encryptSecret } from "./secret-crypto"

const BN_CODE = "MBJTechnolabs_SI_SPB"
const TOKEN_MARGIN_MS = 2 * 60 * 1000

type Environment = "sandbox" | "live"

interface ActiveCredentials {
  environment: Environment
  client_id: string
  client_secret: string
}

export interface AccessTokenResult {
  accessToken: string
  base: string
}

export interface ResolvedSettings {
  additionalSettings: Record<string, unknown>
  advancedCardSettings: Record<string, unknown>
  apiDetails: Record<string, unknown>
}

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
export class PayPalCredentialResolver {
  private db: any
  private tokenRefreshPromise: Promise<string> | null = null

  constructor(pgConnection: any) {
    this.db = pgConnection
  }

  private async getConnectionRow(): Promise<any | null> {
    // Match the module service's soft-delete semantics: this raw knex read
    // bypasses MikroORM's automatic deleted_at filter, so apply it explicitly
    // or a soft-deleted connection's credentials would keep being used.
    const rows = await this.db("paypal_connection")
      .select("*")
      .whereNull("deleted_at")
      .orderBy("created_at", "desc")
      .limit(1)

    return rows?.[0] ?? null
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
  async getRequestedCaptureAmount(captureRowId: string): Promise<number | null> {
    try {
      if (!captureRowId || typeof captureRowId !== "string") return null
      const rows = await this.db("capture")
        .select("amount", "raw_amount")
        .where("id", captureRowId)
        .whereNull("deleted_at")
        .limit(1)
      const row = rows?.[0]
      if (!row) return null
      const raw = row.raw_amount
      if (raw && typeof raw === "object" && raw.value !== undefined) {
        const v = Number(raw.value)
        if (Number.isFinite(v) && v > 0) return v
      }
      const v = Number(row.amount)
      return Number.isFinite(v) && v > 0 ? v : null
    } catch {
      return null
    }
  }

  private getEnvCreds(
    row: any,
    env: Environment
  ): { clientId?: string; clientSecret?: string } {
    const meta = (row?.metadata || {}) as any
    const creds = meta?.credentials?.[env] || {}
    return {
      clientId: creds.client_id || creds.clientId || undefined,
      clientSecret:
        decryptSecret(creds.client_secret || creds.clientSecret) || undefined,
    }
  }

  async getActiveCredentials(): Promise<ActiveCredentials> {
    const row = await this.getConnectionRow()
    if (!row) {
      throw new Error(
        "PayPal connection not found. Please complete onboarding in the admin panel."
      )
    }

    const env: Environment =
      (row.environment as Environment) === "sandbox" ? "sandbox" : "live"
    const c = this.getEnvCreds(row, env)

    if (!c.clientId || !c.clientSecret) {
      throw new Error(
        `PayPal credentials missing for environment "${env}". Please save credentials in the admin panel.`
      )
    }

    return {
      environment: env,
      client_id: c.clientId,
      client_secret: c.clientSecret,
    }
  }

  async getAccessToken(): Promise<AccessTokenResult> {
    const creds = await this.getActiveCredentials()
    const base =
      creds.environment === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com"

    const row = await this.getConnectionRow()
    if (row?.app_access_token && row.app_access_token_expires_at) {
      const expiresAt = new Date(row.app_access_token_expires_at)
      if (expiresAt.getTime() - Date.now() > TOKEN_MARGIN_MS) {
        return {
          accessToken: decryptSecret(row.app_access_token) as string,
          base,
        }
      }
    }

    if (this.tokenRefreshPromise) {
      const accessToken = await this.tokenRefreshPromise
      return { accessToken, base }
    }

    this.tokenRefreshPromise = this.refreshAccessToken(row, creds).finally(
      () => {
        this.tokenRefreshPromise = null
      }
    )

    const accessToken = await this.tokenRefreshPromise
    return { accessToken, base }
  }

  private async refreshAccessToken(
    row: any,
    creds: ActiveCredentials
  ): Promise<string> {
    const base =
      creds.environment === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com"
    const basic = Buffer.from(
      `${creds.client_id}:${creds.client_secret}`
    ).toString("base64")

    const body = new URLSearchParams()
    body.set("grant_type", "client_credentials")

    const res = await paypalFetch(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
        "PayPal-Partner-Attribution-Id": BN_CODE,
      },
      body,
      signal: AbortSignal.timeout(30_000),
    })

    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(
        `PayPal client_credentials failed (${res.status}): ${JSON.stringify(json)}`
      )
    }

    const accessToken = String(json.access_token || "")
    if (!accessToken) {
      throw new Error(
        "PayPal client_credentials succeeded but access_token is missing."
      )
    }

    const expiresIn = Number(json.expires_in || 3600)
    const newExpiresAt = new Date(Date.now() + expiresIn * 1000)

    if (row?.id) {
      await this.db("paypal_connection").where("id", row.id).update({
        app_access_token: encryptSecret(accessToken),
        app_access_token_expires_at: newExpiresAt,
        updated_at: new Date(),
      })
    }

    return accessToken
  }

  async getSettings(): Promise<ResolvedSettings> {
    try {
      const rows = await this.db("paypal_settings")
        .select("data")
        .whereNull("deleted_at")
        .limit(1)

      const data = (rows?.[0]?.data || {}) as Record<string, any>
      return {
        additionalSettings: (data.additional_settings || {}) as Record<
          string,
          unknown
        >,
        advancedCardSettings: (data.advanced_card_payments || {}) as Record<
          string,
          unknown
        >,
        apiDetails: (data.api_details || {}) as Record<string, unknown>,
      }
    } catch {
      return {
        additionalSettings: {},
        advancedCardSettings: {},
        apiDetails: {},
      }
    }
  }

  async recordAuditEvent(
    eventType: string,
    metadata?: Record<string, unknown>
  ) {
    try {
      console.info(
        JSON.stringify({
          log: "paypal_audit",
          event_type: eventType,
          at: new Date().toISOString(),
          ...(metadata ? { metadata } : {}),
        })
      )
    } catch {
      // audit logging must never break the payment flow
    }
  }

  async recordMetric(name: string, metadata?: Record<string, unknown>) {
    try {
      const id = `ppmet_${Date.now().toString(36)}${Math.random()
        .toString(36)
        .slice(2, 8)}`
      const nowIso = new Date().toISOString()
      const metaJson = JSON.stringify(metadata || {})

      // Atomic upsert so concurrent captures/refunds don't lose metric updates
      // via a read-modify-write race. The `count` increment happens inside a
      // single statement (not read in JS then written back), and the unique
      // constraint on `name` drives the ON CONFLICT so there is no insert/update
      // decision to race on either. Any provided metadata is merged first, then
      // `count`/`last_recorded_at` are applied last so metadata can't clobber
      // the running count.
      await this.db.raw(
        `INSERT INTO paypal_metric (id, name, data, created_at, updated_at)
         VALUES (
           ?, ?,
           (?::jsonb || jsonb_build_object('count', 1, 'last_recorded_at', ?::text)),
           now(), now()
         )
         ON CONFLICT (name) DO UPDATE SET
           data = paypal_metric.data
                  || ?::jsonb
                  || jsonb_build_object(
                       'count', COALESCE((paypal_metric.data->>'count')::bigint, 0) + 1,
                       'last_recorded_at', ?::text
                     ),
           deleted_at = NULL,
           updated_at = now()`,
        [id, name, metaJson, nowIso, metaJson, nowIso]
      )
    } catch {
      // metrics must never break the payment flow
    }
  }
}
