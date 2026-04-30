import { MedusaService } from "@medusajs/framework/utils"
import PayPalConnection from "./models/paypal_connection"
import PayPalMetric from "./models/paypal_metric"
import PayPalSettings from "./models/paypal_settings"
import PayPalWebhookEvent from "./models/paypal_webhook_event"
import { getPayPalConfig } from "./types/config"
import { normalizeCurrencyCode } from "./utils/currencies"

type Environment = "sandbox" | "live"

type Status =
  | "disconnected"
  | "pending"
  | "pending_credentials"
  | "connected"
  | "revoked"

class PayPalModuleService extends MedusaService({
  PayPalConnection,
  PayPalMetric,
  PayPalSettings,
  PayPalWebhookEvent,
}) {
  protected cfg = getPayPalConfig()

  private get bnCode(): string {
    return this.cfg.bnCode || "MBJTechnolabs_SI_SPB"
  }

  private async getSettingsData() {
    const settings = await this.getSettings()
    return (settings?.data || {}) as Record<string, any>
  }

  private async ensureSettingsDefaults() {
    const data = await this.getSettingsData()
    const onboarding = { ...(data.onboarding_config || {}) } as Record<string, any>
    const apiDetails = { ...(data.api_details || {}) } as Record<string, any>
    let changed = false

    if (!onboarding.partner_service_url) {
      onboarding.partner_service_url = this.cfg.partnerServiceUrl
      changed = true
    }
    if (!onboarding.partner_js_url) {
      onboarding.partner_js_url = this.cfg.partnerJsUrl
      changed = true
    }
    if (!onboarding.backend_url) {
      onboarding.backend_url = this.cfg.backendUrl
      changed = true
    }
    if (!onboarding.seller_nonce) {
      onboarding.seller_nonce = this.cfg.sellerNonce
      changed = true
    }
    if (!onboarding.bn_code && this.cfg.bnCode) {
      onboarding.bn_code = this.cfg.bnCode
      changed = true
    }
    if (!onboarding.partner_merchant_id_sandbox) {
      onboarding.partner_merchant_id_sandbox = this.cfg.partnerMerchantIdSandbox
      changed = true
    }
    if (!onboarding.partner_merchant_id_live) {
      onboarding.partner_merchant_id_live = this.cfg.partnerMerchantIdLive
      changed = true
    }

    if (!apiDetails.currency_code) {
      const raw = (process.env.PAYPAL_CURRENCY || "").trim()
      apiDetails.currency_code = raw ? normalizeCurrencyCode(raw) : "EUR"
      changed = true
    }
    if (!apiDetails.storefront_url) {
      const storeUrl = process.env.STOREFRONT_URL || process.env.STORE_URL
      if (storeUrl) {
        apiDetails.storefront_url = storeUrl
        changed = true
      }
    }

    if (changed) {
      await this.saveSettings({
        onboarding_config: onboarding,
        api_details: apiDetails,
      })
    }

    return { onboarding, apiDetails }
  }

  async getApiDetails() {
    const { onboarding, apiDetails } = await this.ensureSettingsDefaults()
    return {
      onboarding,
      apiDetails,
    }
  }

  private getAlertWebhookUrls() {
    return (this.cfg.alertWebhookUrls || []).map((url) => url.trim()).filter(Boolean)
  }

  private async getPartnerMerchantId(env: Environment) {
    const { onboarding } = await this.ensureSettingsDefaults()
    return env === "live" ? onboarding.partner_merchant_id_live : onboarding.partner_merchant_id_sandbox
  }

  private async getCurrentRow(): Promise<any | null> {
    const rows = await this.listPayPalConnections({})
    return rows?.[0] ?? null
  }

  private async getCurrentEnvironment(): Promise<Environment> {
    try {
      const row = await this.getCurrentRow()
      const env = (row?.environment as Environment) || "live"
      return env === "sandbox" ? "sandbox" : "live"
    } catch {
      return "live"
    }
  }

  private getEnvCreds(
    row: any,
    env: Environment
  ): { clientId?: string; clientSecret?: string; sellerMerchantId?: string; sellerEmail?: string } {
    const meta = (row?.metadata || {}) as any
    const creds = meta?.credentials?.[env] || {}
    return {
      clientId: creds.client_id || creds.clientId || undefined,
      clientSecret: creds.client_secret || creds.clientSecret || undefined,
      sellerMerchantId:
        creds.seller_merchant_id ||
        creds.sellerMerchantId ||
        creds.payer_id ||
        creds.merchant_id ||
        creds.merchantId ||
        undefined,
      sellerEmail: creds.seller_email || creds.sellerEmail || undefined,
    }
  }

  private extractSellerEmail(...candidates: any[]): string | null {
    const queue = [...candidates]

    while (queue.length > 0) {
      const value = queue.shift()
      if (!value) {
        continue
      }

      if (typeof value === "string") {
        const trimmed = value.trim()
        if (trimmed && trimmed.includes("@")) {
          return trimmed
        }
        continue
      }

      if (Array.isArray(value)) {
        queue.push(...value)
        continue
      }

      if (typeof value === "object") {
        const obj = value as Record<string, any>
        const prioritized = [
          obj.email,
          obj.primary_email,
          obj.merchant_email,
          obj.email_address,
          obj.account_email,
          obj.contact_email,
          obj.value,
          obj.address,
        ]
        queue.push(...prioritized)

        for (const [k, v] of Object.entries(obj)) {
          const key = String(k).toLowerCase()
          if (key.includes("email") || key.includes("address")) {
            queue.push(v)
          }
        }

        queue.push(...Object.values(obj))
      }
    }

    return null
  }

  private async fetchMerchantIntegrationDetails(
    env: Environment,
    merchantId: string,
    accessTokenOverride?: string
  ) {
    const partnerMerchantId = await this.getPartnerMerchantId(env)
    if (!partnerMerchantId) {
      throw new Error("Missing PayPal partner merchant id configuration.")
    }

    const baseUrl = env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"
    const accessToken = accessTokenOverride ?? await this.getAppAccessToken()

    const resp = await fetch(
      `${baseUrl}/v1/customer/partners/${encodeURIComponent(
        partnerMerchantId
      )}/merchant-integrations/${encodeURIComponent(merchantId)}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "PayPal-Partner-Attribution-Id": this.bnCode,
        },
      }
    )

    const text = await resp.text().catch(() => "")
    let json: any = {}
    try {
      json = text ? JSON.parse(text) : {}
    } catch (e: any) {
      console.warn("[PayPal] Failed to parse response JSON — using empty object:", e?.message)
    }

    if (!resp.ok) {
      throw new Error(
        `PayPal merchant integration lookup failed (${resp.status}): ${text || JSON.stringify(json)}`
      )
    }

    return json
  }

  private async getAppAccessTokenForCredentials(
    env: Environment,
    credentials: { clientId: string; clientSecret: string }
  ) {
    const baseUrl = env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"
    const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")

    const body = new URLSearchParams()
    body.set("grant_type", "client_credentials")

    const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
        "PayPal-Partner-Attribution-Id": this.bnCode,
      },
      body,
    })

    const text = await res.text().catch(() => "")
    let json: any = {}
    try {
      json = text ? JSON.parse(text) : {}
    } catch (e: any) {
      console.warn("[PayPal] Failed to parse app token response JSON:", e?.message)
    }

    if (!res.ok) {
      throw new Error(`PayPal client_credentials failed (${res.status}): ${text || JSON.stringify(json)}`)
    }

    const accessToken = String(json.access_token || "")
    if (!accessToken) {
      throw new Error("PayPal client_credentials succeeded but access_token is missing.")
    }

    return { accessToken, tokenPayload: json }
  }

  private async fetchSellerProfileFromDirectCredentials(
    env: Environment,
    credentials?: { clientId: string; clientSecret: string }
  ): Promise<{ sellerMerchantId: string | null; sellerEmail: string | null }> {
    const baseUrl = env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"
    const partnerMerchantId = await this.getPartnerMerchantId(env)
    let tokenPayload: Record<string, any> | null = null

    let accessToken = ""
    if (credentials) {
      const tokenResp = await this.getAppAccessTokenForCredentials(env, {
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
      })
      accessToken = tokenResp.accessToken
      tokenPayload = tokenResp.tokenPayload
    } else {
      accessToken = await this.getAppAccessToken()
    }

    let sellerEmail = this.extractSellerEmail(tokenPayload || undefined)
    let sellerMerchantId = String(
      tokenPayload?.merchant_id || tokenPayload?.payer_id || tokenPayload?.account_id || ""
    ).trim() || null

    try {
      const userInfoResp = await fetch(`${baseUrl}/v1/identity/oauth2/userinfo?schema=paypalv1`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "PayPal-Partner-Attribution-Id": this.bnCode,
        },
      })
      if (userInfoResp.ok) {
        const userInfo = await userInfoResp.json().catch(() => ({}))
        sellerEmail = sellerEmail || this.extractSellerEmail(userInfo)
        sellerMerchantId =
          sellerMerchantId ||
          String(userInfo?.merchant_id || userInfo?.payer_id || userInfo?.user_id || userInfo?.sub || "").trim() ||
          null
      }
    } catch (e: any) {
      console.warn("[PayPal] userinfo lookup failed:", e?.message || e)
    }

    if (partnerMerchantId) {
      try {
        const credsResp = await fetch(
          `${baseUrl}/v1/customer/partners/${encodeURIComponent(
            partnerMerchantId
          )}/merchant-integrations/credentials/`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              "PayPal-Partner-Attribution-Id": this.bnCode,
            },
          }
        )
        if (credsResp.ok) {
          const credsJson = await credsResp.json().catch(() => ({}))
          sellerEmail = sellerEmail || this.extractSellerEmail(credsJson)
          sellerMerchantId = sellerMerchantId || String(credsJson?.merchant_id || "").trim() || null
        }
      } catch (e: any) {
        console.warn("[PayPal] direct credential profile lookup failed:", e?.message || e)
      }
    }

    const hydrated = await this.hydrateSellerMetadataFromCredentials(env, {
      accessToken,
      sellerMerchantId,
      sellerEmail,
    })

    return {
      sellerMerchantId: hydrated.sellerMerchantId,
      sellerEmail: hydrated.sellerEmail,
    }
  }

  private async hydrateSellerMetadataFromCredentials(
    env: Environment,
    input: {
      accessToken?: string
      sellerMerchantId?: string | null
      sellerEmail?: string | null
      metadataCandidates?: any[]
    }
  ): Promise<{ sellerMerchantId: string | null; sellerEmail: string | null }> {
    let sellerMerchantId = (input.sellerMerchantId || "").trim() || null
    let sellerEmail = (input.sellerEmail || "").trim() || null

    if (!sellerEmail && input.metadataCandidates?.length) {
      sellerEmail = this.extractSellerEmail(...input.metadataCandidates)
    }

    if (sellerMerchantId && !sellerEmail) {
      try {
        const details = await this.fetchMerchantIntegrationDetails(env, sellerMerchantId, input.accessToken)
        sellerEmail = this.extractSellerEmail(details)
      } catch (e: any) {
        console.warn("[PayPal] merchant integration lookup failed:", e?.message || e)
      }
    }

    return { sellerMerchantId, sellerEmail }
  }

  private async syncRowFieldsFromMetadata(row: any, env: Environment) {
    const c = this.getEnvCreds(row, env)
    await this.updatePayPalConnections({
      id: row.id,
      status: c.clientId && c.clientSecret ? "connected" : "disconnected",
      seller_client_id: c.clientId || null,
      seller_client_secret: c.clientSecret || null,
      seller_merchant_id: c.sellerMerchantId || null,
      seller_email: c.sellerEmail || null,
      metadata: {
        ...(row.metadata || {}),
        active_environment: env,
      },
    })
  }

  async setEnvironment(env: Environment) {
    const nextEnv: Environment = env === "sandbox" ? "sandbox" : "live"
    const row = await this.getCurrentRow()
    const previousEnv = (row?.environment as Environment) || "live"

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
      })
      await this.recordAuditEvent("environment_switched", {
        previous_environment: previousEnv,
        environment: nextEnv,
      })
      return created
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
    })

    const updated = await this.getCurrentRow()
    if (updated) {
      await this.syncRowFieldsFromMetadata(updated, nextEnv)
    }

    await this.recordAuditEvent("environment_switched", {
      previous_environment: previousEnv,
      environment: nextEnv,
    })
    return await this.getCurrentRow()
  }

  async createOnboardingLink(input?: { email?: string; products?: string[] }) {
    const { onboarding } = await this.ensureSettingsDefaults()
    const return_url = `${String(onboarding.backend_url || "").replace(/\/$/, "")}/admin/paypal/onboard-complete`
    const env = await this.getCurrentEnvironment()
    const partner_merchant_id = await this.getPartnerMerchantId(env)

    const email = (input?.email || "").trim()

    if (!partner_merchant_id) {
      throw new Error("Missing PAYPAL_PARTNER_MERCHANT_ID_* env for current environment")
    }

    const form = new URLSearchParams()
    if (email) {
      form.set("email", email)
    }
    form.set("sandbox", env === "live" ? "no" : "yes")
    form.set("return_url", return_url)
    form.set("return_url_description", "Return to your shop.")
    form.set("partner_merchant_id", partner_merchant_id)
    form.set("from", "medusa")

    const products = input?.products?.length ? input.products : ["PPCP"]

    products.forEach((p, i) => {
      form.append(`products[${i}]`, p)
      form.append("products[]", p)
    })

    const res = await fetch(onboarding.partner_service_url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    })

    const text = await res.text().catch(() => "")
    if (!res.ok) {
      throw new Error(`Onboarding service failed (${res.status}): ${text}`)
    }

    const trimmed = text.trim()

    if (trimmed.startsWith("http")) {
      return { onboarding_url: trimmed, return_url }
    }

    let json: any
    try {
      json = JSON.parse(trimmed)
    } catch {
      throw new Error(`Invalid onboarding link response (not JSON / URL): ${trimmed.slice(0, 200)}`)
    }

    if (json?.body) {
      const inner = typeof json.body === "string" ? json.body.trim() : json.body

      if (typeof inner === "string" && inner.startsWith("http")) {
        return { onboarding_url: inner, return_url }
      }

      try {
        json = typeof inner === "string" ? JSON.parse(inner) : inner
      } catch {
        throw new Error(
          `Onboarding wrapper JSON 'body' is not valid JSON / URL: ${
            typeof inner === "string" ? inner.slice(0, 200) : "[object]"
          }`
        )
      }
    }

    if (json?.name && json?.message && (json?.debug_id || json?.details || json?.links)) {
      const debug = json.debug_id ? ` debug_id=${json.debug_id}` : ""
      const details = Array.isArray(json.details)
        ? json.details
            .slice(0, 3)
            .map((d: any) => {
              const issue = d?.issue ? String(d.issue) : ""
              const desc = d?.description ? String(d.description) : ""
              const field = d?.field ? String(d.field) : ""
              return [issue, desc, field].filter(Boolean).join(" | ")
            })
            .filter(Boolean)
            .join("; ")
        : ""

      throw new Error(`PayPal onboarding error: ${json.name}: ${json.message}.${debug}${details ? ` Details: ${details}` : ""}`)
    }

    if (json?.onboarding_url && String(json.onboarding_url).startsWith("http")) {
      return { onboarding_url: String(json.onboarding_url), return_url }
    }

    const links = Array.isArray(json?.links) ? json.links : null
    if (links) {
      const action = links.find(
        (l: any) => l?.rel === "action_url" || l?.rel === "actionUrl" || l?.rel === "action-url"
      )
      const href = action?.href ? String(action.href) : null
      if (href && href.startsWith("http")) {
        return { onboarding_url: href, return_url }
      }
    }

    throw new Error(
      `Onboarding JSON missing action_url link. Keys: ${Object.keys(json || {}).join(", ")}`
    )
  }

  async startOnboarding() {
    const row = await this.getCurrentRow()
    const env = await this.getCurrentEnvironment()

    if (row) {
      await this.updatePayPalConnections({ id: row.id, status: "pending" })
      return
    }

    await this.createPayPalConnections({
      environment: env,
      status: "pending",
      metadata: {},
    })
  }

  async saveOnboardCallback(input: { authCode: string; sharedId: string }) {
    const row = await this.getCurrentRow()
    const env = await this.getCurrentEnvironment()

    if (!row) {
      return await this.createPayPalConnections({
        environment: env,
        status: "pending_credentials",
        auth_code: input.authCode,
        shared_id: input.sharedId,
        metadata: {},
      })
    }

    return await this.updatePayPalConnections({
      id: row.id,
      status: "pending_credentials",
      auth_code: input.authCode,
      shared_id: input.sharedId,
    })
  }

  async exchangeAndSaveSellerCredentials(input: {
    authCode: string
    sharedId: string
    env?: "sandbox" | "live"
  }) {
    await this.saveOnboardCallback({ authCode: input.authCode, sharedId: input.sharedId })

    const env = (input.env || (await this.getCurrentEnvironment())) as Environment
    const baseUrl = env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"

    const { onboarding } = await this.ensureSettingsDefaults()
    const sellerNonce = (onboarding.seller_nonce || "").trim()
    if (!sellerNonce) {
      throw new Error("PayPal seller nonce is not configured. Set PAYPAL_SELLER_NONCE.")
    }

    const tokenBody = new URLSearchParams()
    tokenBody.set("grant_type", "authorization_code")
    tokenBody.set("code", input.authCode)
    tokenBody.set("code_verifier", sellerNonce)

    const basic = Buffer.from(`${input.sharedId}:`).toString("base64")

    const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
        "PayPal-Partner-Attribution-Id": this.bnCode,
      },
      body: tokenBody,
    })

    const tokenText = await tokenRes.text().catch(() => "")
    let tokenJson: any = {}
    try {
      tokenJson = tokenText ? JSON.parse(tokenText) : {}
    } catch (e: any) {
      console.warn("[PayPal] Failed to parse token response JSON:", e?.message)
    }

    if (!tokenRes.ok) {
      throw new Error(
        `PayPal authorization_code token exchange failed (${tokenRes.status}): ${tokenText || JSON.stringify(tokenJson)}`
      )
    }

    const sellerAccessToken = String(tokenJson.access_token || "")
    if (!sellerAccessToken) {
      throw new Error("PayPal token exchange succeeded but access_token is missing.")
    }

    const partnerMerchantId = await this.getPartnerMerchantId(env)
    if (!partnerMerchantId) {
      throw new Error("Missing PayPal partner merchant id configuration.")
    }

    const credRes = await fetch(
      `${baseUrl}/v1/customer/partners/${encodeURIComponent(partnerMerchantId)}/merchant-integrations/credentials/`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sellerAccessToken}`,
          "PayPal-Partner-Attribution-Id": this.bnCode,
        },
      }
    )

    const credText = await credRes.text().catch(() => "")
    let credJson: any = {}
    try {
      credJson = credText ? JSON.parse(credText) : {}
    } catch (e: any) {
      console.warn("[PayPal] Failed to parse token response JSON:", e?.message)
    }

    if (!credRes.ok) {
      throw new Error(
        `PayPal credentials fetch failed (${credRes.status}): ${credText || JSON.stringify(credJson)}`
      )
    }

    const clientId = String(credJson.client_id || credJson.clientId || "")
    const clientSecret = String(credJson.client_secret || credJson.clientSecret || "")
    if (!clientId || !clientSecret) {
      throw new Error(
        `PayPal credentials response missing client_id/client_secret. Keys: ${Object.keys(credJson || {}).join(", ")}`
      )
    }

    let sellerEmail = this.extractSellerEmail(credJson, tokenJson)
    let sellerMerchantId =
      String(credJson.payer_id || credJson.merchant_id || tokenJson.payer_id || tokenJson.merchant_id || "").trim() ||
      null

    if (!sellerEmail) {
      const merchantCandidates = [
        String(credJson.payer_id || "").trim(),
        String(credJson.merchant_id || "").trim(),
        String(tokenJson.payer_id || "").trim(),
        String(tokenJson.merchant_id || "").trim(),
      ].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i)

      for (const merchantId of merchantCandidates) {
        try {
          const merchantDetails = await this.fetchMerchantIntegrationDetails(env, merchantId, sellerAccessToken)
          sellerMerchantId = sellerMerchantId || merchantId
          sellerEmail = this.extractSellerEmail(merchantDetails)
          if (sellerEmail) {
            break
          }
        } catch (e: any) {
          console.warn(`[PayPal] Merchant integration lookup for ${merchantId} failed:`, e?.message || e)
        }
      }
    }

    await this.saveSellerCredentials({
      clientId,
      clientSecret,
      sellerMerchantId,
      sellerEmail,
    })

    if (!sellerEmail && sellerMerchantId) {
      try {
        const appAccessToken = await this.getAppAccessToken()
        const details = await this.fetchMerchantIntegrationDetails(env, sellerMerchantId, appAccessToken)
        sellerEmail = this.extractSellerEmail(details)
        if (sellerEmail) {
          await this.saveSellerCredentials({ clientId, clientSecret, sellerMerchantId, sellerEmail })
        }
      } catch (e: any) {
        console.warn("[PayPal] Post-save merchant_id email lookup failed:", e?.message || e)
      }
    }
  }

  async saveSellerCredentials(input: {
    clientId: string
    clientSecret: string
    sellerMerchantId?: string | null
    sellerEmail?: string | null
    environment?: Environment
  }) {
    const row = await this.getCurrentRow()
    const currentEnv = await this.getCurrentEnvironment()
    const env = (input.environment || currentEnv) as Environment

    const existingCreds = row ? this.getEnvCreds(row, env) : {}
    const nextSellerMerchantId =
      (input.sellerMerchantId || "").trim() || existingCreds.sellerMerchantId || row?.seller_merchant_id || null
    const nextSellerEmail =
      (input.sellerEmail || "").trim() || existingCreds.sellerEmail || row?.seller_email || null

    const nextCreds = {
      client_id: input.clientId,
      clientId: input.clientId,
      client_secret: input.clientSecret,
      clientSecret: input.clientSecret,
      merchantId: nextSellerMerchantId,
      merchant_id: nextSellerMerchantId,
      payer_id: nextSellerMerchantId,
      seller_merchant_id: nextSellerMerchantId,
      sellerMerchantId: nextSellerMerchantId,
      seller_email: nextSellerEmail,
      sellerEmail: nextSellerEmail,
    }

    if (!row) {
      const created = await this.createPayPalConnections({
        environment: env,
        status: "connected",
        seller_client_id: input.clientId,
        seller_client_secret: input.clientSecret,
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
      })
      await this.recordAuditEvent("credentials_saved", {
        environment: env,
        client_id: input.clientId,
      })
      await this.ensureWebhookRegistration()
      return created
    }

    const meta = (row.metadata || {}) as any
    const creds = { ...(meta.credentials || {}) }
    creds[env] = {
      ...(creds[env] || {}),
      ...nextCreds,
    }

    const updated = await this.updatePayPalConnections({
      id: row.id,
      status: "connected",
      seller_client_id: input.clientId,
      seller_client_secret: input.clientSecret,
      seller_merchant_id: nextSellerMerchantId,
      seller_email: nextSellerEmail,
      app_access_token: null,
      app_access_token_expires_at: null,
      metadata: {
        ...(row.metadata || {}),
        credentials: creds,
        active_environment: env,
      },
    })
    await this.recordAuditEvent("credentials_saved", {
      environment: env,
      client_id: input.clientId,
    })
    await this.ensureWebhookRegistration()
    return updated
  }

  async saveAndHydrateSellerCredentials(input: {
    clientId: string
    clientSecret: string
    environment?: Environment
  }) {
    const env = (input.environment || (await this.getCurrentEnvironment())) as Environment

    await this.saveSellerCredentials({
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      environment: env,
    })

    try {
      const hydrated = await this.fetchSellerProfileFromDirectCredentials(env, {
        clientId: input.clientId,
        clientSecret: input.clientSecret,
      })

      if (hydrated.sellerEmail || hydrated.sellerMerchantId) {
        await this.saveSellerCredentials({
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          sellerMerchantId: hydrated.sellerMerchantId,
          sellerEmail: hydrated.sellerEmail,
          environment: env,
        })
      }

      const refreshedRow = await this.getCurrentRow()
      if (refreshedRow) {
        await this.syncRowFieldsFromMetadata(refreshedRow, env)
      }
    } catch (e: any) {
      console.warn("[PayPal] saveAndHydrateSellerCredentials lookup failed:", e?.message || e)
    }

    return await this.getStatus(env)
  }

  private async resolveWebhookUrl() {
    const { onboarding } = await this.ensureSettingsDefaults()
    const base = String(onboarding.backend_url || "").replace(/\/$/, "")
    if (!base) {
      throw new Error("PayPal backend URL is not configured.")
    }
    return `${base}/store/paypal/webhook`
  }

  private isLocalWebhookUrl(url: string) {
    try {
      const parsed = new URL(url)
      return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    } catch {
      return false
    }
  }

  private async ensureWebhookRegistration() {
    const env = await this.getCurrentEnvironment()
    const { apiDetails } = await this.ensureSettingsDefaults()
    const webhookIds = { ...(apiDetails.webhook_ids || {}) } as Record<string, string>

    if (webhookIds[env]) {
      return webhookIds[env]
    }

    const accessToken = await this.getAppAccessToken()
    const baseUrl = env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"
    const webhookUrl = await this.resolveWebhookUrl()

    if (this.isLocalWebhookUrl(webhookUrl)) {
      await this.recordAuditEvent("webhook_skipped_localhost", {
        environment: env,
        webhook_url: webhookUrl,
      })
      return webhookIds[env] || ""
    }

    const listResp = await fetch(`${baseUrl}/v1/notifications/webhooks`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Partner-Attribution-Id": this.bnCode,
      },
    })

    const listJson = await listResp.json().catch(() => ({}))
    if (!listResp.ok) {
      throw new Error(`PayPal webhook list failed (${listResp.status}): ${JSON.stringify(listJson)}`)
    }

    const existing = Array.isArray(listJson?.webhooks)
      ? listJson.webhooks.find((hook: any) => hook?.url === webhookUrl)
      : null

    let webhookId = existing?.id ? String(existing.id) : ""

    if (!webhookId) {
      const createResp = await fetch(`${baseUrl}/v1/notifications/webhooks`, {
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
      })

      const createJson = await createResp.json().catch(() => ({}))
      if (!createResp.ok) {
        throw new Error(
          `PayPal webhook create failed (${createResp.status}): ${JSON.stringify(createJson)}`
        )
      }

      webhookId = String(createJson?.id || "")
    }

    if (!webhookId) {
      throw new Error("PayPal webhook registration did not return an id")
    }

    const nextWebhookIds = { ...webhookIds, [env]: webhookId }
    await this.saveSettings({
      api_details: {
        ...apiDetails,
        webhook_ids: nextWebhookIds,
      },
    })

    await this.recordAuditEvent("webhook_registered", {
      environment: env,
      webhook_id: webhookId,
      webhook_url: webhookUrl,
    })

    return webhookId
  }

  private maskValue(value?: string | null, visibleChars = 4) {
    if (!value) return null
    const trimmed = String(value)
    if (trimmed.length <= visibleChars) {
      return "•".repeat(trimmed.length)
    }
    return `${"•".repeat(Math.max(0, trimmed.length - visibleChars))}${trimmed.slice(
      -visibleChars
    )}`
  }

  async getStatus(envOverride?: Environment) {
    const row = await this.getCurrentRow()
    const env = envOverride ?? (await this.getCurrentEnvironment())

    if (!row) {
      return { environment: env, status: "disconnected" as Status, seller_client_id_present: false }
    }

    const c = this.getEnvCreds(row, env)
    const hasCreds = !!(c.clientId && c.clientSecret)
    let sellerEmail: string | null = c.sellerEmail || row.seller_email || null
    let sellerMerchantId: string | null = c.sellerMerchantId || row.seller_merchant_id || null

    if (!sellerEmail && hasCreds) {
      try {
        const hydrated = await this.fetchSellerProfileFromDirectCredentials(env)
        if (hydrated.sellerEmail || hydrated.sellerMerchantId) {
          await this.saveSellerCredentials({
            clientId: c.clientId!,
            clientSecret: c.clientSecret!,
            sellerMerchantId: hydrated.sellerMerchantId || sellerMerchantId,
            sellerEmail: hydrated.sellerEmail || sellerEmail,
            environment: env,
          })

          const refreshedRow = await this.getCurrentRow()
          if (refreshedRow) {
            const refreshedCreds = this.getEnvCreds(refreshedRow, env)
            sellerEmail = refreshedCreds.sellerEmail || refreshedRow.seller_email || sellerEmail
            sellerMerchantId =
              refreshedCreds.sellerMerchantId || refreshedRow.seller_merchant_id || sellerMerchantId
          }
        }
      } catch (e: any) {
        console.warn("[PayPal] status direct credential lookup failed:", e?.message || e)
      }
    }

    return {
      environment: env,
      status: (hasCreds ? "connected" : "disconnected") as Status,
      shared_id: row.shared_id ?? null,
      auth_code: row.auth_code ? "***stored***" : null,
      seller_client_id_present: hasCreds,
      seller_client_id_masked: this.maskValue(c.clientId),
      seller_client_secret_masked: c.clientSecret ? "••••••••" : null,
      seller_merchant_id: sellerMerchantId,
      seller_email: sellerEmail,
      updated_at: (row.updated_at as any)?.toISOString?.() ?? null,
    }
  }

  async disconnect() {
    const row = await this.getCurrentRow()
    if (!row) return
    const env = await this.getCurrentEnvironment()

    const meta = (row.metadata || {}) as any
    const creds = { ...(meta.credentials || {}) }
    delete creds[env]

    const hasAnyCreds = Object.values(creds).some((v: any) => {
      return v && typeof v === "object" && (v as any).client_id && (v as any).client_secret
    })

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
    })
    const updated = await this.getCurrentRow()
    if (updated) {
      await this.syncRowFieldsFromMetadata(updated, env)
    }
    await this.recordAuditEvent("disconnected", { environment: env })
  }

  async getAppAccessToken(): Promise<string> {
    const row = await this.getCurrentRow()
    const env = await this.getCurrentEnvironment()
    const creds = await this.getActiveCredentials()

    if (!row) {
      throw new Error("PayPal connection row not found. Please complete onboarding.")
    }

    const expiresAt = row.app_access_token_expires_at ? new Date(row.app_access_token_expires_at as any) : null
    if (row.app_access_token && expiresAt) {
      const msLeft = expiresAt.getTime() - Date.now()
      if (msLeft > 2 * 60 * 1000) return row.app_access_token
    }

    const baseUrl = env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"
    const basic = Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString("base64")

    const body = new URLSearchParams()
    body.set("grant_type", "client_credentials")

    const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
        "PayPal-Partner-Attribution-Id": this.bnCode,
      },
      body,
    })

    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`PayPal client_credentials failed (${res.status}): ${JSON.stringify(json)}`)

    const accessToken = String(json.access_token)
    const expiresIn = Number(json.expires_in || 3600)
    const newExpiresAt = new Date(Date.now() + expiresIn * 1000)

    await this.updatePayPalConnections({
      id: row.id,
      app_access_token: accessToken,
      app_access_token_expires_at: newExpiresAt as any,
    })

    return accessToken
  }

  async generateClientToken(opts?: { locale?: string }): Promise<string> {
    const env = await this.getCurrentEnvironment()
    const baseUrl = env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"

    const accessToken = await this.getAppAccessToken()

    const res = await fetch(`${baseUrl}/v1/identity/generate-token`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "PayPal-Partner-Attribution-Id": this.bnCode,
        ...(opts?.locale ? { "Accept-Language": opts.locale } : {}),
      },
    })

    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(`PayPal generate-token failed (${res.status}): ${JSON.stringify(json)}`)
    }

    const token = String((json as any)?.client_token || "")
    if (!token) {
      throw new Error("PayPal client_token is missing in generate-token response")
    }

    return token
  }

  async getSettings() {
    const rows = await this.listPayPalSettings({})
    const row = rows?.[0]
    return { data: (row?.data || {}) as Record<string, any> }
  }

  private deepMerge(
    target: Record<string, any>,
    source: Record<string, any>
  ): Record<string, any> {
    const result = { ...target }
    for (const key of Object.keys(source)) {
      const sv = source[key]
      const tv = target[key]
      if (
        sv !== null &&
        typeof sv === "object" &&
        !Array.isArray(sv) &&
        tv !== null &&
        typeof tv === "object" &&
        !Array.isArray(tv)
      ) {
        result[key] = this.deepMerge(tv, sv)
      } else {
        result[key] = sv
      }
    }
    return result
  }

  async saveSettings(patch: Record<string, any>) {
    const rows = await this.listPayPalSettings({})
    const row = rows?.[0]
    const current = (row?.data || {}) as Record<string, any>

    const next = this.deepMerge(current, patch)

    if (!row) {
      const created = await this.createPayPalSettings({ data: next })
      return { data: (created.data || {}) as Record<string, any> }
    }

    await this.updatePayPalSettings({ id: row.id, data: next })
    return { data: next }
  }

  async getActiveCredentials() {
    const row = await this.getCurrentRow()
    const env = await this.getCurrentEnvironment()

    if (!row) {
      throw new Error("PayPal connection row not found. Please complete onboarding.")
    }

    const c = this.getEnvCreds(row, env)
    const clientSecret = c.clientSecret || ""

    if (!c.clientId || !clientSecret) {
      throw new Error(
        `PayPal credentials missing for environment "${env}". Please save credentials.`
      )
    }

    return {
      environment: env,
      client_id: c.clientId,
      client_secret: clientSecret,
    }
  }

  async getOrderDetails(orderId: string) {
    if (!orderId) {
      throw new Error("PayPal orderId is required")
    }

    const creds = await this.getActiveCredentials()
    const base =
      creds.environment === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com"
    const auth = Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString("base64")

    const tokenResp = await fetch(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "PayPal-Partner-Attribution-Id": this.bnCode,
      },
      body: "grant_type=client_credentials",
    })

    const tokenText = await tokenResp.text()
    if (!tokenResp.ok) {
      throw new Error(`PayPal token error (${tokenResp.status}): ${tokenText}`)
    }

    const tokenJson = JSON.parse(tokenText)
    const accessToken = String(tokenJson.access_token)

    const resp = await fetch(`${base}/v2/checkout/orders/${orderId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Partner-Attribution-Id": this.bnCode,
      },
    })

    const text = await resp.text()
    if (!resp.ok) {
      throw new Error(`PayPal get order error (${resp.status}): ${text}`)
    }

    return JSON.parse(text)
  }

  async createWebhookEventRecord(input: {
    event_id: string
    event_type: string
    resource_id?: string | null
    payload?: Record<string, unknown>
    event_version?: string | null
    transmission_id?: string | null
    transmission_time?: Date | null
    status?: string
    attempt_count?: number
  }) {
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
      })
      return { created: true, event: created }
    } catch (error: any) {
      const message = String(error?.message || "")
      if (message.includes("paypal_webhook_event_event_id_unique") || message.includes("unique")) {
        const existing = await this.listPayPalWebhookEvents({ event_id: input.event_id })
        return { created: false, event: existing?.[0] ?? null }
      }
      throw error
    }
  }

  async updateWebhookEventRecord(input: {
    id: string
    status?: string
    attempt_count?: number
    next_retry_at?: Date | null
    processed_at?: Date | null
    last_error?: string | null
    resource_id?: string | null
  }) {
    return await this.updatePayPalWebhookEvents({
      id: input.id,
      status: input.status,
      attempt_count: input.attempt_count,
      next_retry_at: input.next_retry_at ?? null,
      processed_at: input.processed_at ?? null,
      last_error: input.last_error ?? null,
      resource_id: input.resource_id ?? null,
    })
  }

  async recordAuditEvent(_eventType: string, _metadata?: Record<string, unknown>) {
    return null
  }

  async recordMetric(name: string, metadata?: Record<string, unknown>) {
    const existing = await this.listPayPalMetrics({ name })
    const row = existing?.[0]
    const current = (row?.data || {}) as Record<string, any>
    const next = {
      ...current,
      ...(metadata || {}),
      count: Number(current.count || 0) + 1,
      last_recorded_at: new Date().toISOString(),
    }

    if (!row) {
      return await this.createPayPalMetrics({
        name,
        data: next,
      })
    }

    return await this.updatePayPalMetrics({
      id: row.id,
      name,
      data: next,
    })
  }

  async recordPaymentLog(eventType: string, metadata?: Record<string, unknown>) {
    return await this.recordAuditEvent(`payment_${eventType}`, metadata)
  }

  async sendAlert(input: {
    type: string
    message: string
    metadata?: Record<string, unknown>
  }) {
    const urls = this.getAlertWebhookUrls()
    if (urls.length === 0) {
      return
    }

    const payload = {
      type: input.type,
      message: input.message,
      metadata: input.metadata ?? {},
      source: "paypal",
      timestamp: new Date().toISOString(),
    }

    await Promise.all(
      urls.map(async (url) => {
        try {
          const resp = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          })
          if (!resp.ok) {
            const text = await resp.text().catch(() => "")
            await this.recordAuditEvent("alert_failed", {
              url,
              status: resp.status,
              response: text,
            })
          } else {
            await this.recordAuditEvent("alert_sent", { url, type: input.type })
          }
        } catch (error: any) {
          await this.recordAuditEvent("alert_failed", {
            url,
            message: error?.message,
          })
        }
      })
    )
  }
}

export default PayPalModuleService
