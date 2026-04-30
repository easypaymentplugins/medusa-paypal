export function getPayPalApiBase(environment: string): string {
  return environment === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com"
}

const BN_CODE = "MBJTechnolabs_SI_SPB"

export async function getPayPalAccessToken(opts: {
  environment: string
  client_id: string
  client_secret: string
}): Promise<{ accessToken: string; base: string }> {
  const base = getPayPalApiBase(opts.environment)
  const auth = Buffer.from(`${opts.client_id}:${opts.client_secret}`).toString("base64")
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
