import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { runCoreWorkflow } from "../../../../../modules/paypal/utils/core-workflow"

type CreatePaymentSessionBody = {
  provider_id: string
  data?: Record<string, unknown>
  customer_id?: string
}

const ALLOWED_PROVIDERS = new Set([
  "pp_paypal_paypal",
  "pp_paypal_card_paypal_card",
])

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const collectionId = req.params.id
  const { provider_id, data, customer_id } = req.body as CreatePaymentSessionBody

  if (!provider_id || !ALLOWED_PROVIDERS.has(provider_id)) {
    return res.status(400).json({ message: "Invalid or unsupported provider_id" })
  }

  if (!collectionId || typeof collectionId !== "string") {
    return res.status(400).json({ message: "Invalid collection id" })
  }

  try {
    const { result } = await runCoreWorkflow(req.scope, "create-payment-sessions", {
      payment_collection_id: collectionId,
      provider_id,
      customer_id,
      data,
    })

    res.status(200).json({ payment_session: result })
  } catch {
    res.status(500).json({ message: "Failed to create payment session" })
  }
}
