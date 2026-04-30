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
import { formatAmountForPayPal, getCurrencyExponent } from "../utils/amounts"
import {
  assertPayPalCurrencySupported,
  normalizeCurrencyCode,
} from "../utils/currencies"
import type PayPalModuleService from "../service"
import { getPayPalWebhookActionAndData } from "./webhook-utils"

type Options = {}

const BN_CODE = "MBJTechnolabs_SI_SPB"

function generateSessionId() {
  try {
    return randomUUID()
  } catch {
    return `pp_${Date.now()}_${Math.random().toString(16).slice(2)}`
  }
}

class PayPalPaymentProvider extends AbstractPaymentProvider<Options> {
  static identifier = "paypal"

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
      return null
    }
  }

  async resolveSettings() {
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
          additionalSettings: (_sData.additional_settings || {}) as Record<string, unknown>,
          apiDetails: (_sData.api_details || {}) as Record<string, unknown>,
        }
      } catch {
        return {
          additionalSettings: {} as Record<string, unknown>,
          apiDetails: {} as Record<string, unknown>,
        }
      }
    }
    const settings = await paypal.getSettings().catch(() => ({}))
    const data =
      settings && typeof settings === "object" && "data" in settings
        ? ((settings as any).data ?? {})
        : {}
    return {
      additionalSettings: (data.additional_settings || {}) as Record<string, unknown>,
      apiDetails: (data.api_details || {}) as Record<string, unknown>,
    }
  }

  private async resolveCurrencyOverride() {
    const { apiDetails } = await this.resolveSettings()
    if (typeof apiDetails.currency_code === "string" && (apiDetails.currency_code as string).trim()) {
      return normalizeCurrencyCode(apiDetails.currency_code as string)
    }
    return normalizeCurrencyCode(process.env.PAYPAL_CURRENCY || "EUR")
  }

  private async getPayPalAccessToken() {
    const paypal = this.resolvePayPalService()
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
      const _fbEnv = _fbRow.environment || "sandbox"
      const _fbCreds =
        (_fbRow.metadata && _fbRow.metadata.credentials && _fbRow.metadata.credentials[_fbEnv]) || {}
      const _fbId = _fbCreds.client_id || _fbRow.seller_client_id
      const _fbSec = _fbCreds.client_secret || _fbRow.seller_client_secret
      const _fbBase =
        _fbEnv === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"
      const _fbAuth = Buffer.from(`${_fbId}:${_fbSec}`).toString("base64")
      const _fbResp = await fetch(`${_fbBase}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${_fbAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "PayPal-Partner-Attribution-Id": BN_CODE,
        },
        body: "grant_type=client_credentials",
      })
      const _fbText = await _fbResp.text()
      if (!_fbResp.ok) throw new Error(`PayPal token error (${_fbResp.status}): ${_fbText}`)
      const _fbJson = JSON.parse(_fbText)
      return { accessToken: String(_fbJson.access_token), base: _fbBase }
    }
    const creds = await paypal.getActiveCredentials()
    const base =
      creds.environment === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com"
    const auth = Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString("base64")

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
    return `pp-${suffix}-${generateSessionId()}`
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
    if (!normalized) return null
    if (normalized === "COMPLETED") return "captured"
    if (normalized === "PENDING") return "pending"
    if (["DENIED", "DECLINED", "FAILED"].includes(normalized)) return "error"
    if (["REFUNDED", "PARTIALLY_REFUNDED", "REVERSED"].includes(normalized)) return "canceled"
    return null
  }

  private mapAuthorizationStatus(status?: string) {
    const normalized = String(status || "").toUpperCase()
    if (!normalized) return null
    if (["CREATED", "APPROVED", "PENDING"].includes(normalized)) return "authorized"
    if (["VOIDED", "EXPIRED"].includes(normalized)) return "canceled"
    if (["DENIED", "DECLINED", "FAILED"].includes(normalized)) return "error"
    return null
  }

  private serializeError(error: unknown) {
    if (error instanceof Error) {
      const errorWithCause = error as Error & { cause?: unknown }
      const cause = errorWithCause.cause
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        cause:
          cause instanceof Error
            ? { name: cause.name, message: cause.message, stack: cause.stack }
            : cause,
      }
    }
    return { message: String(error) }
  }

  private mapOrderStatus(status?: string) {
    const normalized = String(status || "").toUpperCase()
    if (!normalized) return "pending"
    if (normalized === "COMPLETED") return "captured"
    if (normalized === "APPROVED") return "authorized"
    if (["VOIDED", "CANCELLED"].includes(normalized)) return "canceled"
    if (["CREATED", "SAVED", "PAYER_ACTION_REQUIRED"].includes(normalized)) return "pending"
    if (["FAILED", "EXPIRED"].includes(normalized)) return "error"
    return "pending"
  }

  private async recordFailure(eventType: string, metadata?: Record<string, unknown>) {
    const paypal = this.resolvePayPalService()
    if (!paypal) return
    try {
      await paypal.recordPaymentLog(eventType, metadata)
      await paypal.recordAuditEvent(eventType, metadata)
      await paypal.recordMetric(eventType)
    } catch {
    }
  }

  private async recordSuccess(metricName: string) {
    const paypal = this.resolvePayPalService()
    if (!paypal) return
    try {
      await paypal.recordMetric(metricName)
    } catch {
    }
  }

  private async recordPaymentEvent(eventType: string, metadata?: Record<string, unknown>) {
    const paypal = this.resolvePayPalService()
    if (!paypal) return
    try {
      await paypal.recordPaymentLog(eventType, metadata)
    } catch {
    }
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
    const providerId = (input.data as Record<string, any> | undefined)?.provider_id
    try {
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
          ...(providerId ? { provider_id: providerId } : {}),
          amount: input.amount,
          currency_code: currencyCode,
        },
      }
    } catch (error) {
      await this.recordFailure("initiate_failed", {
        error: this.serializeError(error),
        currency_code: input.currency_code,
        amount: input.amount,
        provider_id: providerId,
        data: input.data ?? null,
      })
      throw error
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
    const providerId = (input.data as Record<string, any> | undefined)?.provider_id
    return {
      data: {
        ...(input.data || {}),
        ...(providerId ? { provider_id: providerId } : {}),
        amount: input.amount,
        currency_code: currencyCode,
      },
    }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const { data, amount, currencyCode } = await this.normalizePaymentData(input)
    const existingPayPal = (data.paypal || {}) as Record<string, any>

    const { additionalSettings } = await this.resolveSettings()
    const paymentActionRaw =
      typeof additionalSettings.paymentAction === "string"
        ? additionalSettings.paymentAction
        : "capture"
    const returnStatus = paymentActionRaw === "authorize" ? "authorized" : "captured"
    const timestampKey = paymentActionRaw === "authorize" ? "authorized_at" : "captured_at"

    if (
      existingPayPal.capture_id ||
      existingPayPal.authorization_id ||
      (data as any).authorized_at ||
      (data as any).captured_at
    ) {
      console.info("[PayPal] authorizePayment: session already processed, returning", returnStatus)
      return {
        status: returnStatus,
        data: {
          ...(input.data || {}),
          [timestampKey]: (data as any)[timestampKey] || new Date().toISOString(),
        },
      }
    }

    const orderId = String(existingPayPal.order_id || data.order_id || "")
    if (orderId) {
      try {
        console.info("[PayPal] authorizePayment: fetching live order status for", orderId)
        const order = await this.getOrderDetails(orderId)
        const capture = order?.purchase_units?.[0]?.payments?.captures?.[0]
        const authorization = order?.purchase_units?.[0]?.payments?.authorizations?.[0]

        if (capture?.id || authorization?.id) {
          console.info("[PayPal] authorizePayment: order already processed by PayPal, returning", returnStatus)
          return {
            status: returnStatus,
            data: {
              ...(input.data || {}),
              paypal: {
                ...existingPayPal,
                order_id: orderId,
                order,
                authorization_id: authorization?.id || existingPayPal.authorization_id,
                capture_id: capture?.id || existingPayPal.capture_id,
              },
              [timestampKey]: new Date().toISOString(),
            },
          }
        }

        if (["APPROVED", "CREATED", "SAVED"].includes(String(order?.status || "").toUpperCase())) {
          console.info("[PayPal] authorizePayment: order approved, marking authorized")
          return {
            status: "authorized",
            data: {
              ...(input.data || {}),
              paypal: {
                ...existingPayPal,
                order_id: orderId,
                order,
              },
              authorized_at: new Date().toISOString(),
            },
          }
        }
      } catch (e: any) {
        console.warn("[PayPal] authorizePayment: order lookup failed:", e?.message)
      }
    }

    const requestId = this.getIdempotencyKey(input, "authorize")
    let debugId: string | null = null
    const orderIntent = paymentActionRaw === "authorize" ? "AUTHORIZE" : "CAPTURE"

    try {
      const { accessToken, base } = await this.getPayPalAccessToken()
      const value = formatAmountForPayPal(amount, currencyCode || "EUR")

      const orderPayload = {
        intent: orderIntent,
        purchase_units: [
          {
            reference_id: data.cart_id || data.payment_collection_id || undefined,
            custom_id:
              data.session_id || data.cart_id || data.payment_collection_id || undefined,
            amount: {
              currency_code: currencyCode || "EUR",
              value,
            },
          },
        ],
        custom_id:
          data.session_id || data.cart_id || data.payment_collection_id || undefined,
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

      const order = JSON.parse(ppText) as Record<string, any>
      const newOrderId = String(order.id || "")

      if (!order || !newOrderId) {
        throw new Error("Unable to resolve PayPal order details for authorization.")
      }

      const existingAuthorization =
        order?.purchase_units?.[0]?.payments?.authorizations?.[0] || null

      let authorization: any = null
      if (existingAuthorization) {
        authorization = order
      } else {
        const authorizeResp = await fetch(
          `${base}/v2/checkout/orders/${newOrderId}/authorize`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              "PayPal-Request-Id": `${requestId}-auth`,
              "PayPal-Partner-Attribution-Id": BN_CODE,
            },
          }
        )

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

      await this.recordSuccess("authorize_success")
      await this.recordPaymentEvent("authorize", {
        order_id: newOrderId,
        authorization_id: authorizationId,
        amount,
        currency_code: currencyCode,
        request_id: requestId,
      })

      return {
        status: "authorized",
        data: {
          ...(input.data || {}),
          paypal: {
            ...((input.data || {}).paypal as Record<string, unknown>),
            order_id: newOrderId,
            order: order || authorization,
            authorization_id: authorizationId,
            authorizations:
              authorization?.purchase_units?.[0]?.payments?.authorizations || [],
          },
          authorized_at: new Date().toISOString(),
        },
      }
    } catch (error: any) {
      await this.recordFailure("authorize_failed", {
        request_id: requestId,
        cart_id: data.cart_id,
        payment_collection_id: data.payment_collection_id,
        debug_id: debugId,
        message: error?.message,
      })
      throw error
    }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const data = (input.data || {}) as Record<string, any>
    const paypalData = (data.paypal || {}) as Record<string, any>
    const orderId = String(paypalData.order_id || data.order_id || "")
    if (!orderId) {
      return { data: { ...(input.data || {}) } }
    }

    const order = await this.getOrderDetails(orderId)
    const capture = order?.purchase_units?.[0]?.payments?.captures?.[0]
    const authorization = order?.purchase_units?.[0]?.payments?.authorizations?.[0]

    return {
      data: {
        ...(input.data || {}),
        paypal: {
          ...((input.data || {}).paypal as Record<string, unknown>),
          order,
          authorization_id: authorization?.id || paypalData.authorization_id,
          capture_id: capture?.id || paypalData.capture_id,
        },
      },
    }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const data = (input.data || {}) as Record<string, any>
    const paypalData = (data.paypal || {}) as Record<string, any>
    const orderId = String(paypalData.order_id || data.order_id || "")
    if (!orderId) {
      return { status: "pending", data: { ...(input.data || {}) } }
    }

    try {
      const order = await this.getOrderDetails(orderId)
      const capture = order?.purchase_units?.[0]?.payments?.captures?.[0]
      const authorization = order?.purchase_units?.[0]?.payments?.authorizations?.[0]
      const mappedStatus =
        this.mapCaptureStatus(capture?.status) ||
        this.mapAuthorizationStatus(authorization?.status) ||
        this.mapOrderStatus(order?.status) ||
        "pending"

      await this.recordSuccess("status_success")
      return {
        status: mappedStatus,
        data: {
          ...(input.data || {}),
          paypal: {
            ...((input.data || {}).paypal as Record<string, unknown>),
            order,
            authorization_id: authorization?.id || paypalData.authorization_id,
            capture_id: capture?.id || paypalData.capture_id,
          },
        },
      }
    } catch (error: any) {
      await this.recordFailure("status_failed", {
        order_id: orderId,
        message: error?.message,
      })
      throw error
    }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const data = (input.data || {}) as Record<string, any>
    const paypalData = (data.paypal || {}) as Record<string, any>
    const orderId = String(paypalData.order_id || data.order_id || "")
    let authorizationId = String(
      paypalData.authorization_id || data.authorization_id || ""
    )
    if (!orderId) {
      throw new Error("PayPal order_id is required to capture payment")
    }

    if (paypalData.capture_id || paypalData.capture) {
      return {
        data: {
          ...(input.data || {}),
          paypal: {
            ...((input.data || {}).paypal as Record<string, unknown>),
            capture_id: paypalData.capture_id,
            capture: paypalData.capture,
          },
          captured_at: new Date().toISOString(),
        },
      }
    }

    const requestId = this.getIdempotencyKey(input, `capture-${orderId}`)
    const { amount, currencyCode } = await this.normalizePaymentData(input)
    let debugId: string | null = null

    try {
      const { accessToken, base } = await this.getPayPalAccessToken()
      const order = await this.getOrderDetails(orderId).catch(() => null)
      const existingCapture = order?.purchase_units?.[0]?.payments?.captures?.[0]
      if (existingCapture?.id) {
        return {
          data: {
            ...(input.data || {}),
            paypal: {
              ...((input.data || {}).paypal as Record<string, unknown>),
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
        const authorizeResp = await fetch(
          `${base}/v2/checkout/orders/${orderId}/authorize`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              "PayPal-Request-Id": `${requestId}-auth`,
              "PayPal-Partner-Attribution-Id": BN_CODE,
            },
          }
        )
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

      await this.recordSuccess("capture_success")
      await this.recordPaymentEvent("capture", {
        order_id: orderId,
        capture_id: captureId,
        authorization_id: authorizationId || undefined,
        amount,
        currency_code: currencyCode,
        request_id: requestId,
      })

      return {
        data: {
          ...(input.data || {}),
          paypal: {
            ...((input.data || {}).paypal as Record<string, unknown>),
            order_id: orderId,
            capture_id: captureId,
            capture,
            authorization_id: authorizationId || paypalData.authorization_id,
            captures: [...existingCaptures, captureEntry],
          },
          captured_at: new Date().toISOString(),
        },
      }
    } catch (error: any) {
      await this.recordFailure("capture_failed", {
        order_id: orderId,
        request_id: requestId,
        debug_id: debugId,
        message: error?.message,
      })
      throw error
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const data = (input.data || {}) as Record<string, any>
    const paypalData = (data.paypal || {}) as Record<string, any>
    const captureId = String(paypalData.capture_id || data.capture_id || "")
    const refundReason = String(
      paypalData.refund_reason || data.refund_reason || data.reason || ""
    ).trim()
    const refundReasonCode = String(
      paypalData.refund_reason_code || data.refund_reason_code || data.reason_code || ""
    ).trim()
    if (!captureId) {
      return {
        data: {
          ...(input.data || {}),
          refunded_at: new Date().toISOString(),
        },
      }
    }

    const requestId = this.getIdempotencyKey(input, `refund-${captureId}`)

    const currencyOverride = await this.resolveCurrencyOverride()
    const currencyCode = normalizeCurrencyCode(
      data.currency_code || currencyOverride || "EUR"
    )

    const exponent = currencyCode.toUpperCase() === "JPY" ? 0
      : ["BHD", "JOD", "KWD", "OMR", "TND"].includes(currencyCode.toUpperCase()) ? 3
      : 2
    const refundAmount = Number(input.amount ?? 0)
    const refundValue = refundAmount > 0 ? refundAmount.toFixed(exponent) : null

    let debugId: string | null = null

    try {
      const { accessToken, base } = await this.getPayPalAccessToken()
      const refundPayload: Record<string, any> =
        refundValue
          ? {
              amount: {
                currency_code: currencyCode || "EUR",
                value: refundValue,
              },
            }
          : {}

      if (refundReason) {
        refundPayload.note_to_payer = refundReason
      }

      const ppResp = await fetch(`${base}/v2/payments/captures/${captureId}/refund`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": requestId,
          "PayPal-Partner-Attribution-Id": BN_CODE,
        },
        body: JSON.stringify(refundPayload),
      })

      const ppText = await ppResp.text()
      debugId = ppResp.headers.get("paypal-debug-id")
      if (!ppResp.ok) {
        throw new Error(
          `PayPal refund error (${ppResp.status}): ${ppText}${
            debugId ? ` debug_id=${debugId}` : ""
          }`
        )
      }

      const refund = JSON.parse(ppText)
      const existingRefunds = Array.isArray(paypalData.refunds) ? paypalData.refunds : []
      const refundEntry = {
        id: refund?.id,
        status: refund?.status,
        amount: refund?.amount,
        reason: refundReason || refund?.note_to_payer,
        reason_code: refundReasonCode || refund?.reason_code,
        raw: refund,
      }

      await this.recordSuccess("refund_success")
      await this.recordPaymentEvent("refund", {
        capture_id: captureId,
        refund_id: refund?.id,
        amount: refundAmount,
        currency_code: currencyCode,
        request_id: requestId,
        reason: refundReason,
        reason_code: refundReasonCode,
      })

      return {
        data: {
          ...(input.data || {}),
          paypal: {
            ...((input.data || {}).paypal as Record<string, unknown>),
            refund_id: refund?.id,
            refund_status: refund?.status,
            refund_reason: refundReason || refund?.note_to_payer,
            refund_reason_code: refundReasonCode || refund?.reason_code,
            refunds: [...existingRefunds, refundEntry],
            refund,
          },
          refunded_at: new Date().toISOString(),
        },
      }
    } catch (error: any) {
      await this.recordFailure("refund_failed", {
        capture_id: captureId,
        request_id: requestId,
        debug_id: debugId,
        message: error?.message,
      })
      throw error
    }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const data = (input.data || {}) as Record<string, any>
    const paypalData = (data.paypal || {}) as Record<string, any>
    const orderId = String(paypalData.order_id || data.order_id || "")
    const captureId = String(paypalData.capture_id || data.capture_id || "")
    const storedAuthorizationId = String(
      paypalData.authorization_id || data.authorization_id || ""
    )
    let debugId: string | null = null

    try {
      const order = orderId ? await this.getOrderDetails(orderId) : null
      const intent = String(order?.intent || "").toUpperCase()
      const authorizationId =
        order?.purchase_units?.[0]?.payments?.authorizations?.[0]?.id ||
        storedAuthorizationId

      if (intent === "AUTHORIZE" && authorizationId) {
        const { accessToken, base } = await this.getPayPalAccessToken()
        const requestId = this.getIdempotencyKey(input, `void-${authorizationId}`)

        const resp = await fetch(
          `${base}/v2/payments/authorizations/${authorizationId}/void`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              "PayPal-Request-Id": requestId,
              "PayPal-Partner-Attribution-Id": BN_CODE,
            },
          }
        )

        if (!resp.ok) {
          const text = await resp.text()
          debugId = resp.headers.get("paypal-debug-id")
          throw new Error(
            `PayPal void error (${resp.status}): ${text}${
              debugId ? ` debug_id=${debugId}` : ""
            }`
          )
        }

        await this.recordSuccess("void_success")
        await this.recordPaymentEvent("void", {
          order_id: orderId,
          authorization_id: authorizationId,
        })
      } else if (captureId) {
        const { accessToken, base } = await this.getPayPalAccessToken()
        const requestId = this.getIdempotencyKey(input, `refund-${captureId}`)

        const resp = await fetch(`${base}/v2/payments/captures/${captureId}/refund`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "PayPal-Request-Id": requestId,
            "PayPal-Partner-Attribution-Id": BN_CODE,
          },
          body: JSON.stringify({}),
        })

        if (!resp.ok) {
          const text = await resp.text()
          debugId = resp.headers.get("paypal-debug-id")
          throw new Error(
            `PayPal refund error (${resp.status}): ${text}${
              debugId ? ` debug_id=${debugId}` : ""
            }`
          )
        }

        const refund = await resp.json().catch(() => ({}))
        const existingRefunds = Array.isArray(paypalData.refunds) ? paypalData.refunds : []
        const refundEntry = {
          id: refund?.id,
          status: refund?.status,
          amount: refund?.amount,
          raw: refund,
        }
        paypalData.refund_id = refund?.id
        paypalData.refund_status = refund?.status
        paypalData.refunds = [...existingRefunds, refundEntry]

        await this.recordSuccess("cancel_refund_success")
      }

      return {
        data: {
          ...(input.data || {}),
          paypal: {
            ...((input.data || {}).paypal as Record<string, unknown>),
            order: order || undefined,
            authorization_id: authorizationId || storedAuthorizationId,
            capture_id: captureId || paypalData.capture_id,
            refund_id: paypalData.refund_id,
            refund_status: paypalData.refund_status,
            refunds: paypalData.refunds,
          },
          canceled_at: new Date().toISOString(),
        },
      }
    } catch (error: any) {
      await this.recordFailure("cancel_failed", {
        order_id: orderId,
        capture_id: captureId,
        debug_id: debugId,
        message: error?.message,
      })
      throw error
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

export default PayPalPaymentProvider
export { PayPalPaymentProvider }
