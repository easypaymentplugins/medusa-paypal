import { AbstractPaymentProvider } from "@medusajs/framework/utils"
import { randomUUID } from "crypto"
import type {
  CreateAccountHolderInput,
  CreateAccountHolderOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  ProviderWebhookPayload,
  WebhookActionResult,
} from "@medusajs/framework/types"
import { formatAmountForPayPal, toAmountNumber } from "../utils/amounts"
import {
  assertPayPalCurrencySupported,
  normalizeCurrencyCode,
} from "../utils/currencies"
import { PayPalCredentialResolver } from "../utils/credential-resolver"
import { PAYPAL_PARTNER_ATTRIBUTION_ID } from "../utils/partner"
import { paypalFetch } from "../utils/paypal-fetch"
import { getPayPalWebhookActionAndData } from "./webhook-utils"
import { mapPayPalCaptureStatus } from "./status-utils"

export type Options = {}

/**
 * Shared base for the two PayPal payment providers (wallet buttons and advanced
 * card fields). Both providers ran nearly identical credential/token handling,
 * order-detail fetching, idempotency-key generation, amount normalization, and
 * PayPal→Medusa status mapping — that logic lives here once. Each provider
 * supplies its own `sessionPrefix` / `idempotencyPrefix` and keeps the pieces
 * that genuinely differ (create/authorize/capture/refund/cancel business logic,
 * metric recording, 3-D Secure handling, provider-id passthrough).
 */
export abstract class PayPalProviderBase extends AbstractPaymentProvider<Options> {
  protected readonly options_: Options
  protected paypal: PayPalCredentialResolver

  /** Prefix for generated session ids (e.g. "pp" or "pp_card"). */
  protected abstract readonly sessionPrefix: string
  /** Prefix for generated idempotency keys (e.g. "pp" or "pp-card"). */
  protected abstract readonly idempotencyPrefix: string

  constructor(cradle: Record<string, any>, options: Options) {
    super(cradle, options)
    this.options_ = options
    const pg = PayPalProviderBase.resolvePgConnection(cradle)
    this.paypal = new PayPalCredentialResolver(pg)
  }

  protected static resolvePgConnection(cradle: Record<string, any>): any {
    for (const key of ["__pg_connection__", "pgConnection", "pg_connection"]) {
      try {
        const val = cradle[key]
        if (val) return val
      } catch {}
    }
    throw new Error(
      "Could not resolve pgConnection from the payment module container. " +
        "Ensure the paypal module is registered in medusa-config and the database is accessible."
    )
  }

  protected generateSessionId(): string {
    try {
      return randomUUID()
    } catch {
      return `${this.sessionPrefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
    }
  }

  async resolveSettings() {
    return this.paypal.getSettings()
  }

  protected async resolveCurrencyOverride(): Promise<string> {
    const { apiDetails } = await this.resolveSettings()
    const code = apiDetails.currency_code
    if (typeof code === "string" && code.trim()) {
      return normalizeCurrencyCode(code)
    }
    return normalizeCurrencyCode(process.env.PAYPAL_CURRENCY || "EUR")
  }

  protected async getPayPalAccessToken() {
    return this.paypal.getAccessToken()
  }

  protected async getOrderDetails(orderId: string) {
    const { accessToken, base } = await this.getPayPalAccessToken()
    const resp = await paypalFetch(
      `${base}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "PayPal-Partner-Attribution-Id": PAYPAL_PARTNER_ATTRIBUTION_ID,
        },
      }
    )

    const text = await resp.text()
    if (!resp.ok) {
      throw new Error(`PayPal get order error (${resp.status}): ${text}`)
    }

    return JSON.parse(text)
  }

  protected getIdempotencyKey(
    input: { context?: { idempotency_key?: string } },
    suffix: string
  ): string {
    const key = input?.context?.idempotency_key?.trim()
    if (key) {
      return `${key}-${suffix}`
    }
    return `${this.idempotencyPrefix}-${suffix}-${this.generateSessionId()}`
  }

  protected async normalizePaymentData(input: { data?: Record<string, unknown> }) {
    const data = (input.data || {}) as Record<string, any>
    const amount = toAmountNumber(data.amount)
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

  protected formatAmount(amount: number, currencyCode?: string): string {
    return formatAmountForPayPal(amount, currencyCode || "EUR")
  }

  /**
   * Amount to send to PayPal for a capture. Medusa invokes the provider's
   * capturePayment with only `{ data, context: { idempotency_key } }` — the
   * admin's requested (possibly partial) capture amount is never passed in the
   * input. The idempotency_key IS the Medusa `capture` row id, so resolve the
   * requested amount from that row; otherwise a partial capture would silently
   * charge the buyer the full session total. Falls back to the session amount
   * when the row can't be resolved (preserving full-capture behavior), and
   * never returns more than the session amount.
   */
  protected async resolveRequestedCaptureAmount(
    input: { context?: { idempotency_key?: string } },
    sessionAmount: number
  ): Promise<number> {
    const captureRowId = input?.context?.idempotency_key?.trim()
    if (!captureRowId) return sessionAmount
    const requested = await this.paypal.getRequestedCaptureAmount(captureRowId)
    if (requested === null || !Number.isFinite(requested) || requested <= 0) {
      return sessionAmount
    }
    return Math.min(requested, sessionAmount)
  }

  /**
   * When the session amount or currency changes while a not-yet-approved PayPal
   * order is stored on the session, drop the stored order reference so the next
   * create-order call mints a fresh order at the correct total. Without this, a
   * buyer who opens PayPal (order created for the old total), backs out, and
   * changes the cart gets charged the stale amount. Returns a `{ paypal }`
   * patch to spread into the updated session data, or `{}` when nothing needs
   * invalidating. Sessions that already carry a capture/authorization are never
   * touched.
   */
  protected invalidateStaleOrder(
    input: { data?: Record<string, unknown>; amount?: unknown },
    nextCurrencyCode: string
  ): Record<string, unknown> {
    const data = (input.data || {}) as Record<string, any>
    const paypal = (data.paypal || {}) as Record<string, any>
    if (!paypal.order_id) return {}
    if (paypal.capture_id || paypal.authorization_id) return {}
    const prevAmount = toAmountNumber(data.amount)
    const nextAmount = toAmountNumber(input.amount)
    const prevCurrency = String(data.currency_code || "").toUpperCase()
    const amountChanged =
      prevAmount > 0 && nextAmount > 0 && prevAmount !== nextAmount
    const currencyChanged = !!prevCurrency && prevCurrency !== nextCurrencyCode
    if (!amountChanged && !currencyChanged) return {}
    const { order_id: _orderId, order: _order, ...rest } = paypal
    return { paypal: rest }
  }

  protected mapCaptureStatus(status?: string) {
    // Delegate to the shared, unit-tested mapping so the card and wallet
    // providers agree with each other and with the webhook processor. Notably a
    // PARTIALLY_REFUNDED capture must stay "captured" (only part of the funds
    // were returned) — mapping it to "canceled" would wrongly unwind a live
    // capture.
    return mapPayPalCaptureStatus(status)
  }

  protected mapAuthorizationStatus(status?: string) {
    const normalized = String(status || "").toUpperCase()
    if (!normalized) return null
    if (["CREATED", "APPROVED", "PENDING"].includes(normalized)) return "authorized"
    if (["VOIDED", "EXPIRED"].includes(normalized)) return "canceled"
    if (["DENIED", "DECLINED", "FAILED"].includes(normalized)) return "error"
    return null
  }

  protected mapOrderStatus(status?: string) {
    const normalized = String(status || "").toUpperCase()
    if (!normalized) return "pending"
    if (normalized === "COMPLETED") return "captured"
    if (normalized === "APPROVED") return "authorized"
    if (["VOIDED", "CANCELLED"].includes(normalized)) return "canceled"
    if (["CREATED", "SAVED", "PAYER_ACTION_REQUIRED"].includes(normalized)) return "pending"
    if (["FAILED", "EXPIRED"].includes(normalized)) return "error"
    return "pending"
  }

  async createAccountHolder(
    input: CreateAccountHolderInput
  ): Promise<CreateAccountHolderOutput> {
    const customerId = input.context?.customer?.id
    const externalId = customerId
      ? `paypal_${customerId}`
      : `paypal_${this.generateSessionId()}`
    return {
      id: externalId,
      data: {
        email: input.context?.customer?.email || null,
        customer_id: customerId || null,
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
