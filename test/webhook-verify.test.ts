import { describe, it, expect } from "vitest"
import {
  rawBodyToString,
  composeVerifyRequestBody,
  resolveWebhookEventJson,
} from "../src/modules/paypal/utils/webhook-verify"

describe("rawBodyToString", () => {
  it("returns null for nullish input", () => {
    expect(rawBodyToString(null)).toBeNull()
    expect(rawBodyToString(undefined)).toBeNull()
  })

  it("returns non-empty strings, null for empty", () => {
    expect(rawBodyToString("{}")).toBe("{}")
    expect(rawBodyToString("")).toBeNull()
  })

  it("decodes Buffers", () => {
    expect(rawBodyToString(Buffer.from("hello"))).toBe("hello")
    expect(rawBodyToString(Buffer.alloc(0))).toBeNull()
  })

  it("decodes Uint8Array", () => {
    expect(rawBodyToString(new TextEncoder().encode("hi"))).toBe("hi")
    expect(rawBodyToString(new Uint8Array(0))).toBeNull()
  })

  it("returns null for unsupported types", () => {
    expect(rawBodyToString(123)).toBeNull()
    expect(rawBodyToString({})).toBeNull()
  })
})

describe("composeVerifyRequestBody", () => {
  it("builds valid JSON with the raw event injected verbatim", () => {
    const body = composeVerifyRequestBody(
      {
        auth_algo: "SHA256withRSA",
        cert_url: "https://api.paypal.com/cert",
        transmission_id: "abc",
        transmission_sig: "sig",
        transmission_time: "2026-01-01T00:00:00Z",
        webhook_id: "WH-1",
      },
      '{"id":"evt-1","event_type":"PAYMENT.CAPTURE.COMPLETED"}'
    )
    const parsed = JSON.parse(body)
    expect(parsed.webhook_id).toBe("WH-1")
    expect(parsed.transmission_id).toBe("abc")
    expect(parsed.webhook_event.id).toBe("evt-1")
    expect(parsed.webhook_event.event_type).toBe("PAYMENT.CAPTURE.COMPLETED")
  })

  it("omits undefined / null header fields", () => {
    const body = composeVerifyRequestBody(
      { a: "1", b: undefined, c: null, webhook_id: "WH" },
      "{}"
    )
    const parsed = JSON.parse(body)
    expect(parsed).toHaveProperty("a", "1")
    expect(parsed).not.toHaveProperty("b")
    expect(parsed).not.toHaveProperty("c")
    expect(parsed.webhook_event).toEqual({})
  })

  it("produces valid JSON even with no header fields", () => {
    const body = composeVerifyRequestBody({}, "{}")
    expect(() => JSON.parse(body)).not.toThrow()
    expect(JSON.parse(body)).toEqual({ webhook_event: {} })
  })

  it("does not re-encode the webhook event (byte-preserving)", () => {
    // Non-ASCII must survive verbatim so the hash matches what PayPal signed.
    const raw = '{"name":"José","n":1000}'
    const body = composeVerifyRequestBody({ webhook_id: "WH" }, raw)
    expect(body).toContain(raw)
  })
})

describe("resolveWebhookEventJson", () => {
  it("prefers a non-blank raw body", () => {
    expect(resolveWebhookEventJson('{"a":1}', { a: 2 })).toBe('{"a":1}')
  })

  it("falls back to serializing the parsed body", () => {
    expect(resolveWebhookEventJson(null, { a: 2 })).toBe('{"a":2}')
    expect(resolveWebhookEventJson("   ", { a: 3 })).toBe('{"a":3}')
    expect(resolveWebhookEventJson(undefined, { a: 4 })).toBe('{"a":4}')
  })

  it("serializes to {} when nothing is available", () => {
    expect(resolveWebhookEventJson(null, null)).toBe("{}")
    expect(resolveWebhookEventJson(undefined, undefined)).toBe("{}")
  })
})
