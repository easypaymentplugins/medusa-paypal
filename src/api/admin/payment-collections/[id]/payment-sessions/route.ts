import { createPaymentSessionsWorkflow } from "@medusajs/core-flows"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

type CreatePaymentSessionBody = {
  provider_id: string
  data?: Record<string, unknown>
  customer_id?: string
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const collectionId = req.params.id
  const { provider_id, data, customer_id } = req.body as CreatePaymentSessionBody

  const { result } = await createPaymentSessionsWorkflow(req.scope).run({
    input: {
      payment_collection_id: collectionId,
      provider_id,
      customer_id,
      data,
    },
  })

  res.status(200).json({ payment_session: result })
}
