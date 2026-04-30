import { AbstractPaymentProvider } from "@medusajs/framework/utils"
import { randomUUID } from "crypto"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CreateAccountHolderInput,
  CreateAccountHolderOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  ProviderWebhookPayload,
  WebhookActionResult,
} from "@medusajs/framework/types"
import { getPayPalWebhookActionAndData } from "./webhook-utils"
import { formatAmountForPayPal, getCurrencyExponent } from "../utils/amounts"
import {
  assertPayPalCurrencySupported,
  normalizeCurrencyCode,
} from "../utils/currencies"
import type PayPalModuleService from "../service"

type Options = {}

const BN_CODE = "MBJTechnolabs_SI_SPB"

function generateSessionId() {
  try {
    return randomUUID()
  } catch {
    return `pp_card_${Date.now()}_${Math.random().toString(16).slice(2)}`
  }
}

class PayPalAdvancedCardProvider extends AbstractPaymentProvider<Options> {
  static identifier = "paypal_card"

  protected readonly options_: Options

  constructor(cradle: Record<string, any>, options: Options) {
    super(cradle, options)
    this.options_ = options
  }

  private resolvePayPalService() {
    const container = this.container as {
      resolve<T>(key: string): T
    }
    try {
      return container.resolve<PayPalModuleService>("paypal_onboarding")
    } catch {
      return null as any
    }
  }

  private async resolveSettings() {
    const paypal = this.resolvePayPalService()
    if (!paypal) {
      try {
        const { Pool: _SettingsPool } = require("pg")
        const _sPool = new _SettingsPool({ connectionString: process.env.DATABASE_URL })
        const _sResult = await _sPool
          .query("SELECT data FROM paypal_settings ORDER BY created_at DESC LIMIT 1")
          .finally(() => _sPool.end())
        const _sData = _sResult.rows[0]?.data || {}
        return {
          additionalSettings: (_sData.additional_settings || {}) as Record<string, any>,
          advancedCardSettings: (_sData.advanced_card_payments || {}) as Record<string, any>,
          apiDetails: (_sData.api_details || {}) as Record<string, any>,
        }
      } catch {
        return {
          additionalSettings: {} as Record<string, any>,
          advancedCardSettings: {} as Record<string, any>,
          apiDetails: {} as Record<string, any>,
        }
      }
    }
    const settings = await paypal.getSettings().catch(() => ({}))
    const data =
      settings && typeof settings === "object" && "data" in settings
        ? ((settings as { data?: Record<string, any> }).data ?? {})
        : {}
    return {
      additionalSettings: (data.additional_settings || {}) as Record<string, any>,
      advancedCardSettings: (data.advanced_card_payments || {}) as Record<string, any>,
      apiDetails: (data.api_details || {}) as Record<string, any>,
    }
  }

  private async resolveCurrencyOverride() {
    const { apiDetails } = await this.resolveSettings()
    if (typeof apiDetails.currency_code === "string" && apiDetails.currency_code.trim()) {
      return normalizeCurrencyCode(apiDetails.currency_code)
    }
    return normalizeCurrencyCode(process.env.PAYPAL_CURRENCY || "EUR")
  }

  private async getPayPalAccessToken() {
    const paypal = this.resolvePayPalService()
    let client_id: string
    let client_secret: string
    let environment: string

    if (!paypal) {
      const { Pool: _FbPool } = require("pg")
      const _fbPool = new _FbPool({ connectionString: process.env.DATABASE_URL })
      const _fbResult = await _fbPool
        .query(
          "SELECT metadata, environment, seller_client_id, seller_client_secret FROM paypal_connection WHERE status='connected' ORDER BY created_at DESC LIMIT 1"
        )
        .finally(() => _fbPool.end())
      const _fbRow = _fbResult.rows[0]
      if (!_fbRow) throw new Error("No active PayPal connection found in DB")
      environment = _fbRow.environment || "sandbox"
      const _fbCreds = (_fbRow.metadata?.credentials?.[environment]) || {}
      client_id = _fbCreds.client_id || _fbRow.seller_client_id
      client_secret = _fbCreds.client_secret || _fbRow.seller_client_secret
      console.info("[PayPal Card] getPayPalAccessToken fallback via DB for env:", environment)
    } else {
      const creds = await paypal.getActiveCredentials()
      client_id = creds.client_id
      client_secret = creds.client_secret
      environment = creds.environment
    }

    const base =
      environment === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com"
    const auth = Buffer.from(`${client_id}:${client_secret}`).toString("base64")

    const resp = await fetch(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "PayPal-Partner-Attribution-Id": BN_CODE,
      },
      body: "grant_type=client_credentials",
    })

    const text = await resp.text()
    if (!resp.ok) {
      throw new Error(`PayPal token error (${resp.status}): ${text}`)
    }

    const json = JSON.parse(text)
    return { accessToken: String(json.access_token), base }
  }

  private async getOrderDetails(orderId: string) {
    const { accessToken, base } = await this.getPayPalAccessToken()
    const resp = await fetch(`${base}/v2/checkout/orders/${orderId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Partner-Attribution-Id": BN_CODE,
      },
    })

    const text = await resp.text()
    if (!resp.ok) {
      throw new Error(`PayPal get order error (${resp.status}): ${text}`)
    }

    return JSON.parse(text)
  }

  private getIdempotencyKey(
    input: { context?: { idempotency_key?: string } },
    suffix: string
  ) {
    const key = input?.context?.idempotency_key?.trim()
    if (key) {
      return `${key}-${suffix}`
    }
    return `pp-card-${suffix}-${generateSessionId()}`
  }

  private async normalizePaymentData(input: { data?: Record<string, unknown> }) {
    const data = (input.data || {}) as Record<string, any>
    const amount = Number(data.amount ?? 0)
    const currencyOverride = await this.resolveCurrencyOverride()
    const currencyCode = normalizeCurrencyCode(
      data.currency_code || currencyOverride || "EUR"
    )
    assertPayPalCurrencySupported({
      currencyCode,
      paypalCurrencyOverride: currencyOverride,
    })
    return { data, amount, currencyCode }
  }

  private mapCaptureStatus(status?: string) {
    const normalized = String(status || "").toUpperCase()
    if (!normalized) {
      return null
    }
    if (normalized === "COMPLETED") {
      return "captured"
    }
    if (normalized === "PENDING") {
      return "pending"
    }
    if (["DENIED", "DECLINED", "FAILED"].includes(normalized)) {
      return "error"
    }
    if (["REFUNDED", "PARTIALLY_REFUNDED", "REVERSED"].includes(normalized)) {
      return "canceled"
    }
    return null
  }

  private mapAuthorizationStatus(status?: string) {
    const normalized = String(status || "").toUpperCase()
    if (!normalized) {
      return null
    }
    if (["CREATED", "APPROVED", "PENDING"].includes(normalized)) {
      return "authorized"
    }
    if (["VOIDED", "EXPIRED"].includes(normalized)) {
      return "canceled"
    }
    if (["DENIED", "DECLINED", "FAILED"].includes(normalized)) {
      return "error"
    }
    return null
  }

  private mapOrderStatus(status?: string) {
    const normalized = String(status || "").toUpperCase()
    if (!normalized) {
      return "pending"
    }
    if (normalized === "COMPLETED") {
      return "captured"
    }
    if (normalized === "APPROVED") {
      return "authorized"
    }
    if (["VOIDED", "CANCELLED"].includes(normalized)) {
      return "canceled"
    }
    if (["CREATED", "SAVED", "PAYER_ACTION_REQUIRED"].includes(normalized)) {
      return "pending"
    }
    if (["FAILED", "EXPIRED"].includes(normalized)) {
      return "error"
    }
    return "pending"
  }

  async createAccountHolder(
    input: CreateAccountHolderInput
  ): Promise<CreateAccountHolderOutput> {
    const customerId = input.context?.customer?.id
    const externalId = customerId ? `paypal_${customerId}` : `paypal_${generateSessionId()}`

    return {
      id: externalId,
      data: {
        email: input.context?.customer?.email || null,
        customer_id: customerId || null,
      },
    }
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const currencyOverride = await this.resolveCurrencyOverride()
    const currencyCode = normalizeCurrencyCode(
      input.currency_code || currencyOverride || "EUR"
    )
    assertPayPalCurrencySupported({
      currencyCode,
      paypalCurrencyOverride: currencyOverride,
    })

    return {
      id: generateSessionId(),
      data: {
        ...(input.data || {}),
        amount: input.amount,
        currency_code: currencyCode,
      },
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const currencyOverride = await this.resolveCurrencyOverride()
    const currencyCode = normalizeCurrencyCode(
      input.currency_code || currencyOverride || "EUR"
    )
    assertPayPalCurrencySupported({
      currencyCode,
      paypalCurrencyOverride: currencyOverride,
    })

    return {
      data: {
        ...(input.data || {}),
        amount: input.amount,
        currency_code: currencyCode,
      },
    }
  }

  async authorizePayment(_input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const { data, amount, currencyCode } = await this.normalizePaymentData(_input)
    const requestId = this.getIdempotencyKey(_input, "authorize")
    let debugId: string | null = null
    const { additionalSettings, advancedCardSettings } = await this.resolveSettings()
    const paymentActionRaw =
      typeof additionalSettings.paymentAction === "string"
        ? additionalSettings.paymentAction
        : "capture"
    const orderIntent = paymentActionRaw === "authorize" ? "AUTHORIZE" : "CAPTURE"
    const threeDsRaw =
      typeof advancedCardSettings.threeDS === "string"
        ? advancedCardSettings.threeDS
        : "when_required"
    const threeDsMethod =
      threeDsRaw === "always"
        ? "SCA_ALWAYS"
        : threeDsRaw === "when_required" || threeDsRaw === "sli"
          ? "SCA_WHEN_REQUIRED"
          : null
    const disabledCards = Array.isArray(advancedCardSettings.disabledCards)
      ? advancedCardSettings.disabledCards.map((card: string) => String(card).toLowerCase())
      : []
    const cardBrand = String(
      data.card_brand || data.cardBrand || data?.paypal?.card_brand || ""
    ).toLowerCase()
    if (cardBrand && disabledCards.includes(cardBrand)) {
      throw new Error(`Card brand ${cardBrand} is disabled by admin settings.`)
    }

    const { accessToken, base } = await this.getPayPalAccessToken()
    const existingPayPal = (data.paypal || {}) as Record<string, any>
    let orderId = String(existingPayPal.order_id || data.order_id || "")
    let order: Record<string, any> | null = null
    let authorization: Record<string, any> | null = null

    if (!orderId) {
      const value = formatAmountForPayPal(amount, currencyCode || "EUR")
      const orderPayload = {
        intent: orderIntent,
        purchase_units: [
          {
            reference_id: data.cart_id || data.payment_collection_id || undefined,
            custom_id: data.session_id || data.cart_id || data.payment_collection_id || undefined,
            amount: {
              currency_code: currencyCode || "EUR",
              value,
            },
          },
        ],
        custom_id: data.session_id || data.cart_id || data.payment_collection_id || undefined,
        ...(threeDsMethod
          ? {
              payment_source: {
                card: {
                  attributes: {
                    verification: {
                      method: threeDsMethod,
                    },
                  },
                },
              },
            }
          : {}),
      }

      const ppResp = await fetch(`${base}/v2/checkout/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": requestId,
          "PayPal-Partner-Attribution-Id": BN_CODE,
        },
        body: JSON.stringify(orderPayload),
      })

      const ppText = await ppResp.text()
      debugId = ppResp.headers.get("paypal-debug-id")
      if (!ppResp.ok) {
        throw new Error(
          `PayPal create order error (${ppResp.status}): ${ppText}${
            debugId ? ` debug_id=${debugId}` : ""
          }`
        )
      }

      order = JSON.parse(ppText) as Record<string, any>
      orderId = String(order.id || "")
    } else {
      order = (await this.getOrderDetails(orderId)) as Record<string, any> | null
    }

    if (!order || !orderId) {
      throw new Error("Unable to resolve PayPal order details for authorization.")
    }

    const existingAuthorization =
      order?.purchase_units?.[0]?.payments?.authorizations?.[0] || null

    if (existingAuthorization) {
      authorization = order
    } else {
      const authorizeResp = await fetch(`${base}/v2/checkout/orders/${orderId}/authorize`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": `${requestId}-auth`,
          "PayPal-Partner-Attribution-Id": BN_CODE,
        },
      })

      const authorizeText = await authorizeResp.text()
      const authorizeDebugId = authorizeResp.headers.get("paypal-debug-id")
      if (!authorizeResp.ok) {
        throw new Error(
          `PayPal authorize order error (${authorizeResp.status}): ${authorizeText}${
            authorizeDebugId ? ` debug_id=${authorizeDebugId}` : ""
          }`
        )
      }

      authorization = JSON.parse(authorizeText)
    }

    const authorizationId =
      authorization?.purchase_units?.[0]?.payments?.authorizations?.[0]?.id ||
      existingAuthorization?.id

    return {
      status: "authorized",
      data: {
        ...(data || {}),
        paypal: {
          ...existingPayPal,
          order_id: orderId,
          order: order || authorization,
          authorization_id: authorizationId,
          authorizations: authorization?.purchase_units?.[0]?.payments?.authorizations || [],
        },
        authorized_at: new Date().toISOString(),
      },
    }
  }

  async capturePayment(_input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const data = (_input.data || {}) as Record<string, any>
    const paypalData = (data.paypal || {}) as Record<string, any>
    const orderId = String(paypalData.order_id || data.order_id || "")
    let authorizationId = String(paypalData.authorization_id || data.authorization_id || "")
    if (!orderId) {
      throw new Error("PayPal order_id is required to capture payment")
    }

    if (paypalData.capture_id || paypalData.capture) {
      return {
        data: {
          ...(data || {}),
          paypal: {
            ...paypalData,
            capture_id: paypalData.capture_id,
            capture: paypalData.capture,
          },
          captured_at: new Date().toISOString(),
        },
      }
    }

    const requestId = this.getIdempotencyKey(_input, `capture-${orderId}`)
    const { amount, currencyCode } = await this.normalizePaymentData(_input)
    let debugId: string | null = null

    const { accessToken, base } = await this.getPayPalAccessToken()
    const order = await this.getOrderDetails(orderId).catch(() => null)
    const existingCapture = order?.purchase_units?.[0]?.payments?.captures?.[0]
    if (existingCapture?.id) {
      return {
        data: {
          ...(data || {}),
          paypal: {
            ...paypalData,
            capture_id: existingCapture.id,
            capture: existingCapture,
          },
          captured_at: new Date().toISOString(),
        },
      }
    }

    const resolvedIntent = String(
      order?.intent || paypalData.order?.intent || data.intent || ""
    ).toUpperCase()
    if (!authorizationId && resolvedIntent === "AUTHORIZE") {
      const authorizeResp = await fetch(`${base}/v2/checkout/orders/${orderId}/authorize`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": `${requestId}-auth`,
          "PayPal-Partner-Attribution-Id": BN_CODE,
        },
      })
      const authorizeText = await authorizeResp.text()
      debugId = authorizeResp.headers.get("paypal-debug-id")
      if (!authorizeResp.ok) {
        throw new Error(
          `PayPal authorize order error (${authorizeResp.status}): ${authorizeText}${
            debugId ? ` debug_id=${debugId}` : ""
          }`
        )
      }
      const authorization = JSON.parse(authorizeText)
      authorizationId =
        authorization?.purchase_units?.[0]?.payments?.authorizations?.[0]?.id
    }

    const isFinalCapture =
      paypalData.is_final_capture ??
      data.is_final_capture ??
      data.final_capture ??
      undefined
    const captureExponent = getCurrencyExponent(currencyCode || "EUR")
    const capturePayload =
      amount > 0
        ? {
            amount: {
              currency_code: currencyCode || "EUR",
              value: amount.toFixed(captureExponent),
            },
            ...(typeof isFinalCapture === "boolean"
              ? { is_final_capture: isFinalCapture }
              : {}),
          }
        : {
            ...(typeof isFinalCapture === "boolean"
              ? { is_final_capture: isFinalCapture }
              : {}),
          }

    const captureUrl = authorizationId
      ? `${base}/v2/payments/authorizations/${authorizationId}/capture`
      : `${base}/v2/checkout/orders/${orderId}/capture`

    const ppResp = await fetch(captureUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": requestId,
        "PayPal-Partner-Attribution-Id": BN_CODE,
      },
      body: JSON.stringify(capturePayload),
    })

    const ppText = await ppResp.text()
    debugId = ppResp.headers.get("paypal-debug-id")
    if (!ppResp.ok) {
      throw new Error(
        `PayPal capture error (${ppResp.status}): ${ppText}${
          debugId ? ` debug_id=${debugId}` : ""
        }`
      )
    }

    const capture = JSON.parse(ppText)
    const captureId =
      capture?.id || capture?.purchase_units?.[0]?.payments?.captures?.[0]?.id
    const existingCaptures = Array.isArray(paypalData.captures) ? paypalData.captures : []
    const captureEntry = {
      id: captureId,
      status: capture?.status,
      amount: capture?.amount,
      raw: capture,
    }

    return {
      data: {
        ...(data || {}),
        paypal: {
          ...paypalData,
          order_id: orderId,
          capture_id: captureId,
          capture,
          authorization_id: authorizationId || paypalData.authorization_id,
          captures: [...existingCaptures, captureEntry],
        },
        captured_at: new Date().toISOString(),
      },
    }
  }

  async cancelPayment(_input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const data = (_input.data || {}) as Record<string, any>
    return {
      data: {
        ...(data || {}),
        canceled_at: new Date().toISOString(),
      },
    }
  }

  async refundPayment(_input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const data = (_input.data || {}) as Record<string, any>
    const paypalData = (data.paypal || {}) as Record<string, any>
    const captureId = String(paypalData.capture_id || data.capture_id || "")
    if (!captureId) {
      return {
        data: {
          ...(data || {}),
          refunded_at: new Date().toISOString(),
        },
      }
    }

    const requestId = this.getIdempotencyKey(_input, `refund-${captureId}`)
    const amount = Number(data.amount ?? 0)
    const currencyCode = normalizeCurrencyCode(
      data.currency_code || process.env.PAYPAL_CURRENCY || "EUR"
    )
    const { accessToken, base } = await this.getPayPalAccessToken()
    const refundExponent = getCurrencyExponent(currencyCode)
    const refundPayload: Record<string, any> =
      amount > 0
        ? {
            amount: {
              currency_code: currencyCode,
              value: amount.toFixed(refundExponent),
            },
          }
        : {}

    const resp = await fetch(`${base}/v2/payments/captures/${captureId}/refund`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": requestId,
        "PayPal-Partner-Attribution-Id": BN_CODE,
      },
      body: JSON.stringify(refundPayload),
    })

    const text = await resp.text()
    if (!resp.ok) {
      const debugId = resp.headers.get("paypal-debug-id")
      throw new Error(
        `PayPal refund error (${resp.status}): ${text}${
          debugId ? ` debug_id=${debugId}` : ""
        }`
      )
    }

    const refund = JSON.parse(text)
    const existingRefunds = Array.isArray(paypalData.refunds) ? paypalData.refunds : []
    const refundEntry = {
      id: refund?.id,
      status: refund?.status,
      amount: refund?.amount,
      raw: refund,
    }

    return {
      data: {
        ...(data || {}),
        paypal: {
          ...paypalData,
          refund_id: refund?.id,
          refund_status: refund?.status,
          refunds: [...existingRefunds, refundEntry],
          refund,
        },
        refunded_at: new Date().toISOString(),
      },
    }
  }

  async retrievePayment(_input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const data = (_input.data || {}) as Record<string, any>
    const paypalData = (data.paypal || {}) as Record<string, any>
    const orderId = String(paypalData.order_id || data.order_id || "")
    if (!orderId) {
      return { data: { ...(data || {}) } }
    }

    const order = await this.getOrderDetails(orderId)
    const capture = order?.purchase_units?.[0]?.payments?.captures?.[0]
    const authorization = order?.purchase_units?.[0]?.payments?.authorizations?.[0]

    return {
      data: {
        ...(data || {}),
        paypal: {
          ...paypalData,
          order,
          authorization_id: authorization?.id || paypalData.authorization_id,
          capture_id: capture?.id || paypalData.capture_id,
        },
      },
    }
  }

  async getPaymentStatus(_input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const data = (_input.data || {}) as Record<string, any>
    const paypalData = (data.paypal || {}) as Record<string, any>
    const orderId = String(paypalData.order_id || data.order_id || "")
    if (!orderId) {
      return { status: "pending", data: { ...(data || {}) } }
    }

    const order = await this.getOrderDetails(orderId)
    const capture = order?.purchase_units?.[0]?.payments?.captures?.[0]
    const authorization = order?.purchase_units?.[0]?.payments?.authorizations?.[0]
    const mappedStatus =
      this.mapCaptureStatus(capture?.status) ||
      this.mapAuthorizationStatus(authorization?.status) ||
      this.mapOrderStatus(order?.status) ||
      "pending"

    return {
      status: mappedStatus,
      data: {
        ...(data || {}),
        paypal: {
          ...paypalData,
          order,
          authorization_id: authorization?.id || paypalData.authorization_id,
          capture_id: capture?.id || paypalData.capture_id,
        },
      },
    }
  }

  async deletePayment(_input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: {} }
  }

  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    return getPayPalWebhookActionAndData(payload)
  }
}

export default PayPalAdvancedCardProvider
export { PayPalAdvancedCardProvider }
