import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import type PayPalModuleService from "../modules/paypal/service"
import { getPayPalAccessToken } from "../modules/paypal/utils/paypal-auth"
import { isPayPalProviderId } from "../modules/paypal/utils/provider-ids"

const PATCHABLE_STATUSES = new Set(["CREATED", "APPROVED", "SAVED"])

export default async function paypalOrderInvoiceHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = event?.data?.id
  if (!orderId) return

  try {
    const query = container.resolve("query") as any
    const paypal = container.resolve<PayPalModuleService>("paypal_onboarding")

    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "payment_collections.payment_sessions.id",
        "payment_collections.payment_sessions.data",
        "payment_collections.payment_sessions.provider_id",
        "payment_collections.payment_sessions.status",
        "payment_collections.payment_sessions.created_at",
      ],
      filters: { id: orderId },
    })

    const order = orders?.[0]
    if (!order) return

    const sessions = (order.payment_collections || []).flatMap(
      (pc: any) => pc.payment_sessions || []
    )
    const paypalSession = sessions
      .filter((s: any) => isPayPalProviderId(s.provider_id))
      .sort(
        (a: any, b: any) =>
          new Date(b.created_at || 0).getTime() -
          new Date(a.created_at || 0).getTime()
      )[0]

    if (!paypalSession) {
      console.info(
        "[PayPal] invoice subscriber: no PayPal session for order",
        orderId
      )
      return
    }

    const paypalData = (
      (paypalSession.data || {}).paypal || {}
    ) as Record<string, any>
    const paypalOrderId = String(paypalData.order_id || "")

    if (!paypalOrderId) {
      console.info(
        "[PayPal] invoice subscriber: no order_id in session for order",
        orderId
      )
      return
    }

    const settings = await paypal.getSettings().catch(() => ({}))
    const settingsData =
      settings && typeof settings === "object" && "data" in settings
        ? ((settings as { data?: Record<string, any> }).data ?? {})
        : {}
    const additionalSettings = (
      settingsData.additional_settings || {}
    ) as Record<string, any>
    const invoicePrefix =
      typeof additionalSettings.invoicePrefix === "string"
        ? additionalSettings.invoicePrefix
        : ""
    const displayId = String(order.display_id || "")
    const invoiceId = `${invoicePrefix}${displayId}`.trim()

    if (!invoiceId) return

    const creds = await paypal.getActiveCredentials()
    const { accessToken, base } = await getPayPalAccessToken(creds)

    let paypalOrderStatus = ""
    let currentInvoiceId = ""
    try {
      const statusResp = await fetch(
        `${base}/v2/checkout/orders/${paypalOrderId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      if (statusResp.ok) {
        const currentOrder = await statusResp.json().catch(() => ({}))
        paypalOrderStatus = String(currentOrder?.status || "").toUpperCase()
        currentInvoiceId = currentOrder?.purchase_units?.[0]?.invoice_id || ""
      }
    } catch (e: any) {
      console.warn(
        "[PayPal] invoice subscriber: order status fetch failed:",
        e?.message
      )
    }

    console.info("[PayPal] invoice reconciliation mapping:", {
      medusaOrderId: orderId,
      displayId,
      invoiceId,
      paypalOrderId,
      paypalOrderStatus,
      currentInvoiceId,
    })

    if (paypalOrderStatus && !PATCHABLE_STATUSES.has(paypalOrderStatus)) {
      console.info(
        `[PayPal] invoice_id PATCH skipped — order status is ${paypalOrderStatus} (immutable).`,
        `Reconcile via: PayPal order ${paypalOrderId} = Medusa order #${displayId}`
      )
      return
    }

    if (currentInvoiceId === invoiceId) {
      console.info(
        `[PayPal] invoice_id already "${invoiceId}" — skipping PATCH`
      )
      return
    }

    const patchResp = await fetch(
      `${base}/v2/checkout/orders/${paypalOrderId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          {
            op: "replace",
            path: "/purchase_units/@reference_id=='default'/invoice_id",
            value: invoiceId,
          },
        ]),
      }
    )

    if (patchResp.ok || patchResp.status === 204) {
      console.info(
        `[PayPal] invoice_id updated to "${invoiceId}"`,
        `(PayPal order ${paypalOrderId} / Medusa #${displayId})`
      )
    } else {
      const errText = await patchResp.text().catch(() => "")
      console.warn("[PayPal] invoice_id PATCH failed", {
        status: patchResp.status,
        paypalOrderId,
        invoiceId,
        paypalOrderStatus,
        errText,
      })
    }
  } catch (e: any) {
    console.warn("[PayPal] paypalOrderInvoiceHandler error:", e?.message || e)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
