import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { randomUUID } from "crypto"
import { getCurrencyExponent } from "../../../../modules/paypal/utils/amounts"
import {
  assertPayPalCurrencySupported,
  normalizeCurrencyCode,
} from "../../../../modules/paypal/utils/currencies"
import { getPayPalAccessToken } from "../../../../modules/paypal/utils/paypal-auth"
import type PayPalModuleService from "../../../../modules/paypal/service"
import { isPayPalProviderId } from "../../../../modules/paypal/utils/provider-ids"

const BN_CODE = "MBJTechnolabs_SI_SPB"

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
    return `${String(key).trim()}-${suffix}`
  }
  return fallback || `pp-${suffix}-${randomUUID()}`
}

async function attachPayPalOrderToSession(
  req: MedusaRequest,
  cartId: string,
  orderId: string
) {
  try {
    const paymentCollectionService = req.scope.resolve("payment_collection") as any
    const paymentSessionService = req.scope.resolve("payment_session") as any

    const pc = await paymentCollectionService.retrieveByCartId(cartId).catch(() => null)
    if (!pc?.id) {
      return
    }

    const sessions = await paymentSessionService.list({ payment_collection_id: pc.id })
    const paypalSession = sessions?.find((s: any) => isPayPalProviderId(s.provider_id))
    if (!paypalSession) {
      return
    }

    await paymentSessionService.update(paypalSession.id, {
      amount: paypalSession.amount,
      data: {
        ...(paypalSession.data || {}),
        paypal: {
          ...((paypalSession.data || {}).paypal || {}),
          order_id: orderId,
        },
      },
    })
  } catch {
  }
}

async function getExistingPayPalOrderId(req: MedusaRequest, cartId: string) {
  try {
    const paymentCollectionService = req.scope.resolve("payment_collection") as any
    const paymentSessionService = req.scope.resolve("payment_session") as any

    const pc = await paymentCollectionService.retrieveByCartId(cartId).catch(() => null)
    if (!pc?.id) {
      return null
    }

    const sessions = await paymentSessionService.list({ payment_collection_id: pc.id })
    const paypalSession = sessions?.find((s: any) => isPayPalProviderId(s.provider_id))
    if (!paypalSession) {
      return null
    }

    const paypalData = (paypalSession.data || {}).paypal || {}
    return paypalData.order_id ? String(paypalData.order_id) : null
  } catch {
    return null
  }
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
  let debugId: string | null = null

  try {
    const body = (req.body || {}) as Body
    const cartId = body.cart_id
    const isCardPayment = !!(body as any).is_card_payment

    if (!cartId) {
      return res.status(400).json({ message: "cart_id is required" })
    }

    const existingOrderId = await getExistingPayPalOrderId(req, cartId)
    if (existingOrderId) {
      return res.json({ id: existingOrderId })
    }

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

    const adjustedItemTotal = roundedItemSumFixed

    const diff = parseFloat((adjustedItemTotal - roundedItemSumFixed).toFixed(exponent))

    const finalPurchaseItems = purchaseItemsRaw.map((item: any) => item.paypalItem)

    if (Math.abs(diff) > 0.000001 && sendItemDetails && finalPurchaseItems.length > 0) {
      finalPurchaseItems.push({
        name: "Line Item Amount Offset",
        quantity: "1",
        unit_amount: {
          currency_code: currency,
          value: diff.toFixed(exponent),
        },
      })
    }

    const breakdown: Record<string, any> = {}
    if (adjustedItemTotal > 0) {
      breakdown.item_total = {
        currency_code: currency,
        value: adjustedItemTotal.toFixed(exponent),
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

    const discountValue = discountMajor + giftCardMajor
    if (discountValue > 0 && finalPurchaseItems.length > 0) {
      breakdown.discount = {
        currency_code: currency,
        value: discountValue.toFixed(exponent),
      }
    }

    const breakdownSum = parseFloat(
      (adjustedItemTotal + shippingMajor + taxMajor - discountValue).toFixed(exponent)
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

    const { accessToken, base } = await getPayPalAccessToken({
      environment: creds.environment,
      client_id: creds.client_id,
      client_secret: creds.client_secret,
    })

    const requestId = resolveIdempotencyKey(req, "create-order", `pp-create-${cart.id}`)

    const ppResp = await fetch(`${base}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": requestId,
        "PayPal-Partner-Attribution-Id": BN_CODE,
      },
      body: JSON.stringify({
        intent: paymentAction,
        purchase_units: [
          {
            reference_id: "default",
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
    try {
      const body = (req.body || {}) as Body
      await paypal.recordAuditEvent("create_order_failed", {
        cart_id: body.cart_id,
        debug_id: debugId,
        message: e?.message || String(e),
      })
      await paypal.recordMetric("create_order_failed")
    } catch {
    }
    const message = e?.message || "Failed to create PayPal order"
    const status = message.includes("PayPal does not support currency")
      ? 400
      : message.includes("PayPal is configured for")
        ? 400
        : 500
    return res.status(status).json({ message })
  }
}
