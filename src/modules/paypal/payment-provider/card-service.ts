import { AbstractPaymentProvider, MedusaError } from "@medusajs/framework/utils"
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
import { formatAmountForPayPal, toAmountNumber } from "../utils/amounts"
import { paypalFetch } from "../utils/paypal-fetch"
import {
  assertPayPalCurrencySupported,
  normalizeCurrencyCode,
} from "../utils/currencies"
import {
  extractCaptureStatus,
  isCaptureCompleted,
  isRefundFailureStatus,
  mapPayPalCaptureStatus,
} from "./status-utils"
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
      return {
        additionalSettings: {} as Record<string, any>,
        advancedCardSettings: {} as Record<string, any>,
        apiDetails: {} as Record<string, any>,
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
    if (!paypal) {
      throw new Error("PayPal service is not available. Cannot obtain access token without a valid PayPal connection.")
    }
    const creds = await paypal.getActiveCredentials()
    const base =
      creds.environment === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com"
    const accessToken = await paypal.getAppAccessToken()
    return { accessToken, base }
  }

  private async getOrderDetails(orderId: string) {
    const { accessToken, base } = await this.getPayPalAccessToken()
    const resp = await paypalFetch(`${base}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
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
    // Delegate to the shared, unit-tested mapping so the card provider agrees
    // with the wallet provider and the webhook processor. In particular a
    // PARTIALLY_REFUNDED capture must stay "captured" (only part of the funds
    // were returned) — mapping it to "canceled" would wrongly unwind a live
    // capture.
    return mapPayPalCaptureStatus(status)
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
    const returnStatus = paymentActionRaw === "authorize" ? "authorized" : "captured"
    const timestampKey = paymentActionRaw === "authorize" ? "authorized_at" : "captured_at"
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

    const existingPayPal = (data.paypal || {}) as Record<string, any>

    if (
      existingPayPal.capture_id ||
      existingPayPal.authorization_id ||
      (data as any).authorized_at ||
      (data as any).captured_at
    ) {
      return {
        status: returnStatus,
        data: {
          ...(_input.data || {}),
          [timestampKey]: (data as any)[timestampKey] || new Date().toISOString(),
        },
      }
    }

    const { accessToken, base } = await this.getPayPalAccessToken()
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

      const ppResp = await paypalFetch(`${base}/v2/checkout/orders`, {
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
    const existingCapture =
      order?.purchase_units?.[0]?.payments?.captures?.[0] || null

    if (existingAuthorization) {
      authorization = order
    } else if (existingCapture) {
      return {
        status: returnStatus,
        data: {
          ...(data || {}),
          paypal: {
            ...existingPayPal,
            order_id: orderId,
            order,
            capture_id: existingCapture.id,
            capture: existingCapture,
          },
          [timestampKey]: new Date().toISOString(),
        },
      }
    } else {
      const authorizeResp = await paypalFetch(`${base}/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {
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
    if (existingCapture?.id && isCaptureCompleted(existingCapture)) {
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
      const authorizeResp = await paypalFetch(`${base}/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {
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
    const captureValue = amount > 0
      ? formatAmountForPayPal(amount, currencyCode || "EUR")
      : null

    // `amount` and `is_final_capture` are only honored on the authorizations
    // capture endpoint. The orders capture endpoint always captures the FULL
    // order and silently ignores an `amount` body — so a partial amount there
    // would over-capture while we record the smaller requested value. Route
    // partial captures through the authorization, and fail closed if a partial
    // capture is attempted against a capture-intent order.
    let capturePayload: Record<string, unknown>
    let captureUrl: string
    if (authorizationId) {
      captureUrl = `${base}/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`
      capturePayload = {
        ...(captureValue
          ? { amount: { currency_code: currencyCode || "EUR", value: captureValue } }
          : {}),
        ...(typeof isFinalCapture === "boolean" ? { is_final_capture: isFinalCapture } : {}),
      }
    } else {
      captureUrl = `${base}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`
      capturePayload = {}
      const orderTotal = order?.purchase_units?.[0]?.amount?.value
      if (captureValue && orderTotal && captureValue !== String(orderTotal)) {
        throw new Error(
          `PayPal partial capture (${captureValue} ${currencyCode || "EUR"}) is not supported for ` +
            `capture-intent orders (order total ${orderTotal}). Create the order with intent ` +
            `AUTHORIZE to capture a partial amount.`
        )
      }
    }

    const ppResp = await paypalFetch(captureUrl, {
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

    // A 2xx response does NOT mean the funds were captured. PayPal returns 201
    // for captures that are PENDING (pending review / eCheck), DECLINED, or
    // FAILED. Recording any of these as "captured" books money that never
    // settled, so only a COMPLETED capture is treated as success.
    const captureStatus = extractCaptureStatus(capture)
    if (captureStatus !== "COMPLETED") {
      throw new Error(
        `PayPal capture did not complete (status=${captureStatus || "UNKNOWN"}). ` +
          `The payment was not captured.${debugId ? ` debug_id=${debugId}` : ""}`
      )
    }

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
    const paypalData = (data.paypal || {}) as Record<string, any>
    const orderId = String(paypalData.order_id || data.order_id || "")
    const captureId = String(paypalData.capture_id || data.capture_id || "")
    const storedAuthorizationId = String(
      paypalData.authorization_id || data.authorization_id || ""
    )

    const order = orderId ? await this.getOrderDetails(orderId) : null
    const intent = String(order?.intent || "").toUpperCase()
    const authorizationId =
      order?.purchase_units?.[0]?.payments?.authorizations?.[0]?.id ||
      storedAuthorizationId

    if (intent === "AUTHORIZE" && authorizationId) {
      const { accessToken, base } = await this.getPayPalAccessToken()
      const requestId = this.getIdempotencyKey(_input, `void-${authorizationId}`)

      const resp = await paypalFetch(
        `${base}/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`,
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
        const debugId = resp.headers.get("paypal-debug-id")
        throw new Error(
          `PayPal void error (${resp.status}): ${text}${
            debugId ? ` debug_id=${debugId}` : ""
          }`
        )
      }
    } else if (captureId) {
      const { accessToken, base } = await this.getPayPalAccessToken()
      const requestId = this.getIdempotencyKey(_input, `cancel-refund-${captureId}`)

      const resp = await paypalFetch(
        `${base}/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "PayPal-Request-Id": requestId,
            "PayPal-Partner-Attribution-Id": BN_CODE,
          },
          body: JSON.stringify({}),
        }
      )

      if (!resp.ok) {
        const text = await resp.text()
        const debugId = resp.headers.get("paypal-debug-id")
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

      return {
        data: {
          ...(data || {}),
          paypal: {
            ...paypalData,
            order: order || undefined,
            authorization_id: authorizationId || storedAuthorizationId,
            capture_id: captureId || paypalData.capture_id,
            refund_id: refund?.id,
            refund_status: refund?.status,
            refunds: [...existingRefunds, refundEntry],
          },
          canceled_at: new Date().toISOString(),
        },
      }
    }

    return {
      data: {
        ...(data || {}),
        paypal: {
          ...paypalData,
          order: order || undefined,
          authorization_id: authorizationId || storedAuthorizationId,
          capture_id: captureId || paypalData.capture_id,
        },
        canceled_at: new Date().toISOString(),
      },
    }
  }

  async refundPayment(_input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const data = (_input.data || {}) as Record<string, any>
    const paypalData = (data.paypal || {}) as Record<string, any>
    const captureId = String(paypalData.capture_id || data.capture_id || "")
    if (!captureId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "PayPal capture_id is required to refund payment. No capture found in session data."
      )
    }

    // Use the refund amount Medusa passes (top-level input), not the session
    // amount in `data` — otherwise a partial refund would refund the full order.
    // Medusa passes it as a BigNumberInput, so coerce it to a number; a naive
    // Number() of the object form yields NaN and silently refunds the full
    // capture.
    const amount = toAmountNumber(_input.amount)
    const requestId = this.getIdempotencyKey(_input, `refund-${captureId}-${amount}`)
    const currencyOverride = await this.resolveCurrencyOverride()
    const currencyCode = normalizeCurrencyCode(
      data.currency_code || currencyOverride || "EUR"
    )

    try {
      const { accessToken, base } = await this.getPayPalAccessToken()
      const refundPayload: Record<string, any> =
        amount > 0
          ? {
              amount: {
                currency_code: currencyCode,
                value: formatAmountForPayPal(amount, currencyCode),
              },
            }
          : {}

      const resp = await paypalFetch(`${base}/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
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
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `PayPal refund error (${resp.status}): ${text}${
            debugId ? ` debug_id=${debugId}` : ""
          }`
        )
      }

      const refund = JSON.parse(text)

      // As with captures, a 2xx response does not guarantee the refund stuck.
      // FAILED / CANCELLED / DENIED refunds also return 2xx and must not be
      // recorded as a successful refund. PENDING is accepted: PayPal processes
      // refunds asynchronously and a pending refund will settle.
      const refundStatus = String(refund?.status || "").toUpperCase()
      if (isRefundFailureStatus(refundStatus)) {
        const refundDebugId = resp.headers.get("paypal-debug-id")
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `PayPal refund did not succeed (status=${refundStatus}). The refund was not issued.` +
            (refundDebugId ? ` debug_id=${refundDebugId}` : "")
        )
      }

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
    } catch (error: any) {
      // Surface the real reason: Medusa masks any non-MedusaError as a generic
      // "An unknown error occurred." in production, hiding the PayPal failure.
      throw error instanceof MedusaError
        ? error
        : new MedusaError(
            MedusaError.Types.UNEXPECTED_STATE,
            error?.message || "PayPal refund failed."
          )
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
