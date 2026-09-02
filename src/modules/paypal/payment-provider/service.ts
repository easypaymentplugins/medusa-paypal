import { MedusaError } from "@medusajs/framework/utils"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
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
} from "@medusajs/framework/types"
import { formatAmountForPayPal, toAmountNumber } from "../utils/amounts"
import {
  assertPayPalCurrencySupported,
  normalizeCurrencyCode,
} from "../utils/currencies"
import { PAYPAL_PARTNER_ATTRIBUTION_ID } from "../utils/partner"
import { paypalFetch, paypalFetchWithRetry } from "../utils/paypal-fetch"
import {
  extractCaptureStatus,
  isCaptureCompleted,
  isRefundFailureStatus,
} from "./status-utils"
import { PayPalProviderBase } from "./base-provider"

class PayPalPaymentProvider extends PayPalProviderBase {
  static identifier = "paypal"

  protected readonly sessionPrefix = "pp"
  protected readonly idempotencyPrefix = "pp"

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
        id: this.generateSessionId(),
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
        ...this.invalidateStaleOrder(input, currencyCode),
        ...(providerId ? { provider_id: providerId } : {}),
        amount: input.amount,
        currency_code: currencyCode,
      },
    }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const { data } = await this.normalizePaymentData(input)
    const existingPayPal = (data.paypal || {}) as Record<string, any>

    // Session already carries a settled capture: trust it without a network
    // round-trip. The stored capture object is only written after a COMPLETED
    // gate (capture-order route / capturePayment), but re-verify its status
    // here so a PENDING/DECLINED capture patched in by a webhook is never
    // booked as captured money.
    const storedCaptureStatus = extractCaptureStatus(existingPayPal.capture)
    if (storedCaptureStatus === "COMPLETED") {
      console.info("[PayPal] authorizePayment: session already captured (COMPLETED)")
      return {
        status: "captured",
        data: {
          ...(input.data || {}),
          captured_at: (data as any).captured_at || new Date().toISOString(),
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

        // Derive the returned status from what actually happened at PayPal —
        // NOT from the mere presence of a capture/authorization id and NOT
        // from the merchant's configured paymentAction. A PENDING capture
        // (eCheck / pending review) must not be booked as captured, and a
        // DENIED/DECLINED one must fail the authorization outright.
        if (capture?.id) {
          const captureStatus = this.mapCaptureStatus(capture?.status)
          if (captureStatus === "captured") {
            return {
              status: "captured",
              data: {
                ...(input.data || {}),
                paypal: {
                  ...existingPayPal,
                  order_id: orderId,
                  order,
                  authorization_id: authorization?.id || existingPayPal.authorization_id,
                  capture_id: capture.id,
                  capture,
                },
                captured_at: new Date().toISOString(),
              },
            }
          }
          if (captureStatus === "pending") {
            // Funds are in flight (eCheck etc.): place the order as authorized
            // so checkout completes, but never mark it captured — the
            // CAPTURE.COMPLETED webhook settles it later.
            return {
              status: "authorized",
              data: {
                ...(input.data || {}),
                paypal: {
                  ...existingPayPal,
                  order_id: orderId,
                  order,
                  capture_id: capture.id,
                },
                authorized_at: new Date().toISOString(),
              },
            }
          }
          if (captureStatus === "error" || captureStatus === "canceled") {
            return {
              status: "error",
              data: {
                ...(input.data || {}),
                paypal: { ...existingPayPal, order_id: orderId, order },
              },
            }
          }
        }

        if (authorization?.id) {
          const authStatus = this.mapAuthorizationStatus(authorization?.status)
          if (authStatus === "authorized") {
            return {
              status: "authorized",
              data: {
                ...(input.data || {}),
                paypal: {
                  ...existingPayPal,
                  order_id: orderId,
                  order,
                  authorization_id: authorization.id,
                },
                authorized_at: new Date().toISOString(),
              },
            }
          }
          if (authStatus === "error" || authStatus === "canceled") {
            return {
              status: "error",
              data: {
                ...(input.data || {}),
                paypal: { ...existingPayPal, order_id: orderId, order },
              },
            }
          }
        }

        // Only a buyer-APPROVED order counts as authorized. CREATED/SAVED
        // means the buyer never approved the payment — treating those as
        // authorized would let a cart complete with no funds authorized at
        // PayPal at all.
        if (String(order?.status || "").toUpperCase() === "APPROVED") {
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
        // Fall back to the session's own record when PayPal is unreachable so a
        // transient lookup error doesn't fail a checkout that already has a
        // real authorization/capture behind it. `captured_at` is only ever
        // stamped after a COMPLETED gate; a bare capture_id (e.g. patched in by
        // a webhook) or authorization id maps to "authorized" — the order is
        // placed without claiming settled funds.
        if ((data as any).captured_at) {
          return {
            status: "captured",
            data: { ...(input.data || {}), captured_at: (data as any).captured_at },
          }
        }
        if (
          existingPayPal.capture_id ||
          existingPayPal.authorization_id ||
          (data as any).authorized_at
        ) {
          return {
            status: "authorized",
            data: {
              ...(input.data || {}),
              authorized_at: (data as any).authorized_at || new Date().toISOString(),
            },
          }
        }
      }
    }

    // No usable PayPal order on the session: nothing can be authorized. The
    // previous fallback created a brand-new PayPal order here and immediately
    // called /v2/checkout/orders/{id}/authorize on it — but an order no buyer
    // has approved can never be authorized (PayPal rejects it with
    // ORDER_NOT_APPROVED), so that path only produced confusing 422s and
    // orphaned PayPal orders. Fail with a clear, actionable error instead.
    await this.recordFailure("authorize_failed", {
      cart_id: data.cart_id,
      payment_collection_id: data.payment_collection_id,
      message: "no approved PayPal order on session",
    })
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "No approved PayPal payment was found for this session. The buyer must approve the payment with PayPal before the cart can be completed."
    )
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

    const { amount: sessionAmount, currencyCode } = await this.normalizePaymentData(input)
    // The requested (possibly partial) capture amount lives on the Medusa
    // capture row, not in the provider input — resolve it so partial captures
    // don't charge the full session total.
    const amount = await this.resolveRequestedCaptureAmount(input, sessionAmount)
    // Include the amount in the idempotency suffix: PayPal deduplicates by
    // PayPal-Request-Id, so two sequential partial captures of the same order
    // that share an upstream idempotency_key would otherwise collide and the
    // second capture would silently return the first one's result.
    const requestId = this.getIdempotencyKey(input, `capture-${orderId}-${amount}`)
    let debugId: string | null = null

    try {
      const { accessToken, base } = await this.getPayPalAccessToken()
      const order = await this.getOrderDetails(orderId).catch(() => null)
      const existingCapture = order?.purchase_units?.[0]?.payments?.captures?.[0]
      if (existingCapture?.id && isCaptureCompleted(existingCapture)) {
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
        const authorizeResp = await paypalFetch(
          `${base}/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              "PayPal-Request-Id": `${requestId}-auth`,
              "PayPal-Partner-Attribution-Id": PAYPAL_PARTNER_ATTRIBUTION_ID,
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
      const captureValue = amount > 0
        ? formatAmountForPayPal(amount, currencyCode || "EUR")
        : null

      // `amount` and `is_final_capture` are only valid on the authorizations
      // capture endpoint. The orders capture endpoint always captures the FULL
      // order and silently ignores an `amount` body — so sending a partial
      // amount there would over-capture while we record the (smaller) requested
      // value. Route partial captures to the authorization, and fail closed if a
      // partial capture is attempted against a capture-intent order.
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

      // Retry transient 5xx/429/timeout: the PayPal-Request-Id makes the
      // capture idempotent, so a retry after a network blip re-uses the same
      // capture instead of double-charging.
      const ppResp = await paypalFetchWithRetry(captureUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": requestId,
          "PayPal-Partner-Attribution-Id": PAYPAL_PARTNER_ATTRIBUTION_ID,
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
      // for captures that are PENDING (e.g. pending review / eCheck), DECLINED,
      // or FAILED. Recording any of these as "captured" books money that never
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
      throw error instanceof MedusaError
        ? error
        : new MedusaError(
            MedusaError.Types.INVALID_DATA,
            error?.message || "PayPal capture failed."
          )
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
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "PayPal capture_id is required to refund payment. No capture found in session data."
      )
    }

    // Medusa passes the refund amount as a BigNumberInput (BigNumber instance or
    // serialized { value, precision }); coerce it to a number so partial refunds
    // send the correct value instead of silently refunding the full capture.
    const refundAmount = toAmountNumber(input.amount)

    // Include the amount in the idempotency suffix so two sequential partial
    // refunds of the same capture are not deduplicated by PayPal into one.
    const requestId = this.getIdempotencyKey(
      input,
      `refund-${captureId}-${refundAmount}`
    )

    const currencyOverride = await this.resolveCurrencyOverride()
    const currencyCode = normalizeCurrencyCode(
      data.currency_code || currencyOverride || "EUR"
    )

    const refundValue = refundAmount > 0
      ? formatAmountForPayPal(refundAmount, currencyCode)
      : null

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
        // PayPal rejects a note_to_payer longer than 255 characters with a 422
        // (which would otherwise fail the whole refund); truncate defensively.
        refundPayload.note_to_payer = refundReason.slice(0, 255)
      }

      // Retry transient 5xx/429/timeout: the PayPal-Request-Id (which includes
      // the refund amount) makes the refund idempotent, so a retry after a
      // network blip re-uses the same refund instead of double-refunding.
      const ppResp = await paypalFetchWithRetry(`${base}/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": requestId,
          "PayPal-Partner-Attribution-Id": PAYPAL_PARTNER_ATTRIBUTION_ID,
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

      // As with captures, a 2xx response does not guarantee the refund stuck.
      // FAILED / CANCELLED / DENIED refunds also return 2xx and must not be
      // recorded as a successful refund. PENDING is accepted: PayPal processes
      // refunds asynchronously and a pending refund will settle.
      const refundStatus = String(refund?.status || "").toUpperCase()
      if (isRefundFailureStatus(refundStatus)) {
        throw new Error(
          `PayPal refund did not succeed (status=${refundStatus}). The refund was not issued.` +
            (debugId ? ` debug_id=${debugId}` : "")
        )
      }

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
      throw error instanceof MedusaError
        ? error
        : new MedusaError(
            MedusaError.Types.INVALID_DATA,
            error?.message || "PayPal refund failed."
          )
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

        const resp = await paypalFetch(
          `${base}/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              "PayPal-Request-Id": requestId,
              "PayPal-Partner-Attribution-Id": PAYPAL_PARTNER_ATTRIBUTION_ID,
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
        const requestId = this.getIdempotencyKey(input, `cancel-refund-${captureId}`)

        const resp = await paypalFetch(`${base}/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "PayPal-Request-Id": requestId,
            "PayPal-Partner-Attribution-Id": PAYPAL_PARTNER_ATTRIBUTION_ID,
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

        // As with refundPayment: a 2xx response does not guarantee the refund
        // stuck — FAILED / CANCELLED / DENIED refunds also return 2xx. Booking
        // `canceled_at` for a refund that never went through would record a
        // cancellation while the merchant keeps the funds.
        const cancelRefundStatus = String(refund?.status || "").toUpperCase()
        if (isRefundFailureStatus(cancelRefundStatus)) {
          throw new Error(
            `PayPal cancel-refund did not succeed (status=${cancelRefundStatus}). The payment was not canceled.`
          )
        }

        const existingRefunds = Array.isArray(paypalData.refunds) ? paypalData.refunds : []
        const refundEntry = {
          id: refund?.id,
          status: refund?.status,
          amount: refund?.amount,
          raw: refund,
        }

        await this.recordSuccess("cancel_refund_success")

        return {
          data: {
            ...(input.data || {}),
            paypal: {
              ...((input.data || {}).paypal as Record<string, unknown>),
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
          ...(input.data || {}),
          paypal: {
            ...((input.data || {}).paypal as Record<string, unknown>),
            order: order || undefined,
            authorization_id: authorizationId || storedAuthorizationId,
            capture_id: captureId || paypalData.capture_id,
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

}

export default PayPalPaymentProvider
export { PayPalPaymentProvider }
