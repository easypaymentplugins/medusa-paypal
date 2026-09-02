import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { randomUUID } from "crypto"
import { getCurrencyExponent } from "../../../../modules/paypal/utils/amounts"
import {
  assertPayPalCurrencySupported,
  normalizeCurrencyCode,
} from "../../../../modules/paypal/utils/currencies"
import { getPayPalApiBase } from "../../../../modules/paypal/utils/paypal-auth"
import { PAYPAL_PARTNER_ATTRIBUTION_ID as BN_CODE } from "../../../../modules/paypal/utils/partner"
import { paypalFetch } from "../../../../modules/paypal/utils/paypal-fetch"
import type PayPalModuleService from "../../../../modules/paypal/service"
import {
  findPayPalSessionForCart,
  getStoredPayPalOrderId,
  updatePayPalSessionData,
} from "../../../../modules/paypal/utils/payment-session"

type Body = {
  cart_id: string
  is_card_payment?: boolean
}

function resolveIdempotencyKey(req: MedusaRequest, suffix: string, fallback: string) {
  const header =
    req.headers["idempotency-key"] ||
    req.headers["Idempotency-Key"] ||
    req.headers["x-idempotency-key"] ||
    req.headers["X-Idempotency-Key"]
  const key = Array.isArray(header) ? header[0] : header
  if (key && String(key).trim()) {
    // The suffix must include the cart id (callers pass it): PayPal caches by
    // PayPal-Request-Id, so a client reusing one idempotency-key header across
    // two carts would otherwise get cart A's cached order (A's amount) back
    // for cart B.
    return `${String(key).trim()}-${suffix}`
  }
  return fallback || `pp-${suffix}-${randomUUID()}`
}

// Persist the PayPal order id onto the cart's PayPal payment session so that
// capture-order can bind the capture to the order this cart created. Resolved
// through the Payment module service (the previous direct-container resolve of
// "payment_collection"/"payment_session" did not exist in the request scope, so
// the id was silently never stored and every capture failed fail-closed).
async function attachPayPalOrderToSession(
  req: MedusaRequest,
  cartId: string,
  orderId: string
) {
  const session = await findPayPalSessionForCart(cartId, req.scope)
  if (!session) {
    return
  }
  await updatePayPalSessionData(
    session.session_id,
    {
      paypal: {
        ...(session.session_data.paypal || {}),
        order_id: orderId,
      },
    },
    req.scope
  )
}

async function getExistingPayPalOrderId(req: MedusaRequest, cartId: string) {
  const session = await findPayPalSessionForCart(cartId, req.scope)
  return getStoredPayPalOrderId(session?.session_data)
}

function resolveReturnUrl(req: MedusaRequest) {
  const configured = process.env.STOREFRONT_URL || process.env.STORE_URL
  if (!configured) {
    return undefined
  }
  return `${configured.replace(/\/$/, "")}/checkout`
}

function resolveCancelUrl(req: MedusaRequest) {
  const configured = process.env.STOREFRONT_URL || process.env.STORE_URL
  if (!configured) {
    return undefined
  }
  return `${configured.replace(/\/$/, "")}/cart`
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const paypal = req.scope.resolve<PayPalModuleService>("paypal_onboarding")
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER)
  const requestId = randomUUID()
  let debugId: string | null = null

  try {
    const body = (req.body || {}) as Body
    const cartId = body.cart_id
    const isCardPayment = !!(body as any).is_card_payment

    if (!cartId || typeof cartId !== "string") {
      return res.status(400).json({ message: "cart_id is required" })
    }

    if (!cartId.startsWith("cart_")) {
      return res.status(400).json({ message: "Invalid cart_id format" })
    }

    // A stored order id is only reused after verifying it still matches the
    // cart (amount/currency/state) — see below, once the cart is loaded. Buyers
    // who back out of the PayPal popup and change their cart would otherwise be
    // charged the stale total.
    const existingOrderId = await getExistingPayPalOrderId(req, cartId)

    const query = req.scope.resolve("query")

    const { data } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "total",
        "subtotal",
        "shipping_total",
        "tax_total",
        "discount_total",
        "gift_card_total",
        "currency_code",
        "region.currency_code",
        "items.title",
        "items.quantity",
        "items.unit_price",
        "items.subtotal",
        "items.tax_total",
        "items.total",
      ],
      filters: { id: cartId },
    })

    const cart = (data?.[0] as any) || null

    if (!cart) {
      return res.status(404).json({ message: "Cart not found" })
    }

    const creds = await paypal.getActiveCredentials()

    type PayPalSettingsResponse = {
      data?: {
        additional_settings?: Record<string, unknown>
        api_details?: Record<string, unknown>
        advanced_card_payments?: Record<string, unknown>
      }
    }
    const settings = await paypal
      .getSettings()
      .catch((): PayPalSettingsResponse => ({}))
    const settingsData = (settings.data || {}) as Record<string, any>
    const additionalSettings = settingsData.additional_settings || {}
    const apiDetails = settingsData.api_details || {}
    const advancedCardSettings = (settingsData.advanced_card_payments || {}) as Record<string, any>

    const threeDsRaw =
      typeof advancedCardSettings.threeDS === "string"
        ? advancedCardSettings.threeDS
        : "when_required"

    const threeDsMethod: string | null = isCardPayment
      ? (threeDsRaw === "always"
          ? "SCA_ALWAYS"
          : "SCA_WHEN_REQUIRED")
      : null
    const configuredCurrency =
      typeof apiDetails.currency_code === "string"
        ? normalizeCurrencyCode(apiDetails.currency_code)
        : normalizeCurrencyCode(process.env.PAYPAL_CURRENCY || "EUR")

    const currency = normalizeCurrencyCode(
      cart.region?.currency_code || cart.currency_code || configuredCurrency
    )
    assertPayPalCurrencySupported({
      currencyCode: currency,
      paypalCurrencyOverride: configuredCurrency,
    })

    const exponent = getCurrencyExponent(currency)
    const totalMajor = Number(cart.total || 0)
    const value = totalMajor.toFixed(exponent)

    // Reuse the stored PayPal order only when it still matches the cart: same
    // amount, same currency, and still in a reusable (pre-terminal) state. On
    // mismatch fall through and create a fresh order (which replaces the
    // stored id on the session). If PayPal can't be reached for the check,
    // reuse the stored id — matching the previous behavior rather than
    // blocking checkout on a transient error.
    if (existingOrderId) {
      try {
        const checkBase = getPayPalApiBase(creds.environment)
        const checkToken = await paypal.getAppAccessToken()
        const checkResp = await paypalFetch(
          `${checkBase}/v2/checkout/orders/${encodeURIComponent(existingOrderId)}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${checkToken}`,
              "Content-Type": "application/json",
            },
          }
        )
        if (checkResp.ok) {
          const existingOrder = await checkResp.json()
          const existingAmount = existingOrder?.purchase_units?.[0]?.amount
          const existingStatus = String(existingOrder?.status || "").toUpperCase()
          const reusableStatus = ["CREATED", "APPROVED", "PAYER_ACTION_REQUIRED"].includes(
            existingStatus
          )
          const amountMatches =
            String(existingAmount?.value || "") === value &&
            String(existingAmount?.currency_code || "").toUpperCase() === currency
          if (reusableStatus && amountMatches) {
            return res.json({ id: existingOrderId })
          }
          if (existingStatus === "COMPLETED") {
            // Already paid — never mint a second order for this cart.
            return res.json({ id: existingOrderId })
          }
          logger.info(
            `[paypal] create-order: stored order ${existingOrderId} is stale (status=${existingStatus}, amount=${existingAmount?.value} ${existingAmount?.currency_code} vs cart ${value} ${currency}) — creating a fresh order (request_id=${requestId})`
          )
        } else if (checkResp.status !== 404) {
          // Transient PayPal-side failure: reuse rather than block checkout.
          return res.json({ id: existingOrderId })
        }
        // 404: the stored order no longer exists (e.g. environment switched) —
        // fall through and create a fresh one.
      } catch {
        return res.json({ id: existingOrderId })
      }
    }

    const paymentActionRaw =
      typeof additionalSettings.paymentAction === "string"
        ? additionalSettings.paymentAction
        : "capture"
    const paymentAction = paymentActionRaw === "authorize" ? "AUTHORIZE" : "CAPTURE"
    const brandName =
      typeof additionalSettings.brandName === "string"
        ? additionalSettings.brandName
        : undefined
    const landingPageRaw =
      typeof additionalSettings.landingPage === "string"
        ? additionalSettings.landingPage
        : undefined
    const landingPage =
      landingPageRaw === "login"
        ? "LOGIN"
        : landingPageRaw === "billing"
          ? "BILLING"
          : landingPageRaw === "no_preference"
            ? "NO_PREFERENCE"
            : undefined
    const requireInstantPayment =
      typeof additionalSettings.requireInstantPayment === "boolean"
        ? additionalSettings.requireInstantPayment
        : undefined
    const sendItemDetails = additionalSettings.sendItemDetails !== false
    const statementName =
      typeof additionalSettings.creditCardStatementName === "string"
        ? additionalSettings.creditCardStatementName.trim()
        : ""
    const invoicePrefix =
      typeof additionalSettings.invoicePrefix === "string"
        ? additionalSettings.invoicePrefix
        : ""
    const cartIdSuffix = cart.id.slice(-12).toUpperCase()
    const invoiceId = `${invoicePrefix}${cartIdSuffix}`.trim() || cart.id
    const returnUrl =
      (typeof apiDetails.storefront_url === "string" && apiDetails.storefront_url.trim()
        ? `${apiDetails.storefront_url.replace(/\/$/, "")}/checkout`
        : resolveReturnUrl(req))
    const cancelUrl =
      (typeof apiDetails.storefront_url === "string" && apiDetails.storefront_url.trim()
        ? `${apiDetails.storefront_url.replace(/\/$/, "")}/cart`
        : resolveCancelUrl(req))

    const applicationContext: Record<string, any> = {
      ...(brandName ? { brand_name: brandName } : {}),
      ...(landingPage ? { landing_page: landingPage } : {}),
      ...(requireInstantPayment ? { payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED" } : {}),
      ...(returnUrl ? { return_url: returnUrl } : {}),
      ...(cancelUrl ? { cancel_url: cancelUrl } : {}),
    }

    const subtotalMajor = Number(cart.subtotal || 0)
    const shippingMajor = Number(cart.shipping_total || 0)
    const taxMajor = Number(cart.tax_total || 0)
    const discountMajor = Number(cart.discount_total || 0)
    const giftCardMajor = Number(cart.gift_card_total || 0)
    const lineItems = Array.isArray((cart as any).items) ? (cart as any).items : []

    const purchaseItemsRaw = sendItemDetails
      ? lineItems
          .map((item: any) => {
            const quantity = Number(item?.quantity || 0)
            const lineSubtotalMajor = Number(
              item?.subtotal ?? (Number(item?.unit_price || 0) * quantity)
            )
            const unitAmount =
              quantity > 0 ? parseFloat((lineSubtotalMajor / quantity).toFixed(exponent)) : 0

            if (!quantity || Number.isNaN(quantity) || Number.isNaN(unitAmount)) {
              return null
            }

            return {
              quantity,
              unitAmount,
              paypalItem: {
                name: String(item?.title || "Item").slice(0, 127),
                quantity: String(Math.max(1, quantity)),
                unit_amount: {
                  currency_code: currency,
                  value: unitAmount.toFixed(exponent),
                },
              },
            }
          })
          .filter(Boolean)
      : []

    const roundedItemSum = purchaseItemsRaw.reduce(
      (sum: number, item: any) => sum + item.unitAmount * item.quantity,
      0
    )
    const roundedItemSumFixed = parseFloat(roundedItemSum.toFixed(exponent))

    const finalPurchaseItems = purchaseItemsRaw.map((item: any) => item.paypalItem)

    // Reconcile rounding drift so the items we send sum to the cart subtotal.
    if (finalPurchaseItems.length > 0) {
      const diff = parseFloat((subtotalMajor - roundedItemSumFixed).toFixed(exponent))
      if (Math.abs(diff) > 0.000001) {
        finalPurchaseItems.push({
          name: "Line Item Amount Offset",
          quantity: "1",
          unit_amount: {
            currency_code: currency,
            value: diff.toFixed(exponent),
          },
        })
      }
    }

    // Only send line items (and an item_total) when we actually have them.
    const sendItems = finalPurchaseItems.length > 0

    // item_total MUST equal the exact sum of (unit_amount * quantity) of the
    // items we send; otherwise PayPal rejects with ITEM_TOTAL_MISMATCH.
    const itemsTotalMajor = sendItems
      ? parseFloat(
          finalPurchaseItems
            .reduce(
              (sum: number, it: any) =>
                sum + Number(it.unit_amount.value) * Number(it.quantity),
              0
            )
            .toFixed(exponent)
        )
      : 0

    const discountValue = discountMajor + giftCardMajor

    // Build a breakdown only when we send line items. A breakdown whose
    // item_total has no matching items (or items with no item_total) is
    // rejected by PayPal, so with no items we send just the order total.
    const breakdown: Record<string, any> = {}
    if (sendItems) {
      if (itemsTotalMajor > 0) {
        breakdown.item_total = {
          currency_code: currency,
          value: itemsTotalMajor.toFixed(exponent),
        }
      }
      if (shippingMajor > 0) {
        breakdown.shipping = {
          currency_code: currency,
          value: shippingMajor.toFixed(exponent),
        }
      }
      if (taxMajor > 0) {
        breakdown.tax_total = {
          currency_code: currency,
          value: taxMajor.toFixed(exponent),
        }
      }
      if (discountValue > 0) {
        breakdown.discount = {
          currency_code: currency,
          value: discountValue.toFixed(exponent),
        }
      }

      const breakdownSum = parseFloat(
        (itemsTotalMajor + shippingMajor + taxMajor - discountValue).toFixed(exponent)
      )

      if (Math.abs(breakdownSum - totalMajor) > 0.000001) {
        const gap = parseFloat((totalMajor - breakdownSum).toFixed(exponent))

        if (gap > 0) {
          breakdown.tax_total = {
            currency_code: currency,
            value: parseFloat(
              ((Number(breakdown.tax_total?.value || 0) + gap).toFixed(exponent))
            ).toFixed(exponent),
          }
        } else {
          breakdown.shipping_discount = {
            currency_code: currency,
            value: Math.abs(gap).toFixed(exponent),
          }
        }
      }
    }

    logger.debug(
      `[paypal] create-order line items (request_id=${requestId}): send_item_details=${sendItemDetails}, cart_items=${lineItems.length}, sent_items=${finalPurchaseItems.length}, items_total=${itemsTotalMajor}, subtotal=${subtotalMajor}, total=${totalMajor}`
    )

    // Use the module's cached app access token (single-flight refresh, ~9h TTL)
    // instead of minting a fresh OAuth token on every create-order call.
    const base = getPayPalApiBase(creds.environment)
    const accessToken = await paypal.getAppAccessToken()

    // Deterministic-per-(cart, amount, currency) idempotency key for the PayPal
    // call. The amount/currency MUST be part of the key: PayPal replays the
    // cached response for a reused PayPal-Request-Id, so a key derived from the
    // cart id alone would return the ORIGINAL order (at the original total)
    // when the buyer changes the cart and a fresh order is minted — silently
    // re-charging the stale amount and defeating the staleness check above.
    // Kept distinct from `requestId` (the log/response correlation id declared
    // at the top of POST) so the two never shadow each other.
    const paypalRequestId = resolveIdempotencyKey(
      req,
      `create-order-${cart.id}-${value}-${currency}`,
      `pp-create-${cart.id}-${value}-${currency}`
    )

    const ppResp = await paypalFetch(`${base}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": paypalRequestId,
        "PayPal-Partner-Attribution-Id": BN_CODE,
      },
      body: JSON.stringify({
        intent: paymentAction,
        purchase_units: [
          {
            reference_id: "default",
            // Set custom_id on the purchase unit (not just the order) so PayPal
            // propagates the cart id onto capture/refund webhook resources,
            // letting webhooks resolve the session directly without a scan.
            custom_id: cart.id,
            invoice_id: invoiceId,
            ...(statementName ? { soft_descriptor: statementName.slice(0, 22) } : {}),
            amount: {
              currency_code: currency,
              value,
              ...(Object.keys(breakdown).length > 0 ? { breakdown } : {}),
            },
            ...(finalPurchaseItems.length > 0 ? { items: finalPurchaseItems } : {}),
          },
        ],
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
        custom_id: cart.id,
        ...(Object.keys(applicationContext).length > 0
          ? { application_context: applicationContext }
          : {}),
      }),
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

    const order = JSON.parse(ppText)

    await attachPayPalOrderToSession(req, cart.id, order.id)

    try {
      await paypal.recordMetric("create_order_success")
    } catch {
    }
    return res.json({ id: order.id })
  } catch (e: any) {
    const body = (req.body || {}) as Body
    logger.error(
      `[paypal] create-order failed (request_id=${requestId}, cart_id=${
        body.cart_id ?? "n/a"
      }, debug_id=${debugId ?? "n/a"}): ${e?.message ?? String(e)}`,
      e instanceof Error ? e : undefined
    )
    try {
      await paypal.recordAuditEvent("create_order_failed", {
        cart_id: body.cart_id,
        debug_id: debugId,
        request_id: requestId,
        message: e?.message || String(e),
      })
      await paypal.recordMetric("create_order_failed")
    } catch {
    }
    const rawMessage = e?.message || ""
    const isCurrencyError =
      rawMessage.includes("PayPal does not support currency") ||
      rawMessage.includes("PayPal is configured for")
    const status = isCurrencyError ? 400 : 500
    const message = isCurrencyError ? rawMessage : "Failed to create PayPal order"
    return res.status(status).json({ message, request_id: requestId })
  }
}
