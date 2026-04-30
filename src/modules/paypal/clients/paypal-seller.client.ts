export class PayPalSellerClient {
  private static readonly BN_CODE = "MBJTechnolabs_SI_SPB"

  constructor(private opts: { environment: "sandbox" | "live"; accessToken: string }) {}

  private baseUrl() {
    return this.opts.environment === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com"
  }

  private headers(extra?: Record<string, string>) {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.opts.accessToken}`,
      "PayPal-Partner-Attribution-Id": PayPalSellerClient.BN_CODE,
      ...(extra ?? {}),
    }
  }

  async createOrder(body: any) {
    const res = await fetch(`${this.baseUrl()}/v2/checkout/orders`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`PayPal createOrder failed (${res.status}): ${JSON.stringify(json)}`)
    return json
  }

  async getOrder(orderId: string) {
    const res = await fetch(`${this.baseUrl()}/v2/checkout/orders/${orderId}`, {
      method: "GET",
      headers: this.headers(),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`PayPal getOrder failed (${res.status}): ${JSON.stringify(json)}`)
    return json
  }

  async captureOrder(orderId: string) {
    const res = await fetch(`${this.baseUrl()}/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: this.headers(),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`PayPal captureOrder failed (${res.status}): ${JSON.stringify(json)}`)
    return json
  }

  async refundCapture(captureId: string, body?: any) {
    const res = await fetch(`${this.baseUrl()}/v2/payments/captures/${captureId}/refund`, {
      method: "POST",
      headers: this.headers(),
      body: body ? JSON.stringify(body) : "{}",
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`PayPal refund failed (${res.status}): ${JSON.stringify(json)}`)
    return json
  }
}
