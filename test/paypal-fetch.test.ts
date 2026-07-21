import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * paypalFetchWithRetry is the retry wrapper now wired into capture/refund. These
 * tests mock global.fetch and re-import the module per test (vi.resetModules) so
 * the module-level circuit-breaker state starts clean each time.
 */

function jsonResponse(status: number, body: any = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

async function loadModule() {
  vi.resetModules()
  return await import("../src/modules/paypal/utils/paypal-fetch")
}

describe("paypalFetchWithRetry", () => {
  const realFetch = global.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    global.fetch = realFetch
  })

  it("returns immediately on a 2xx without retrying", async () => {
    const { paypalFetchWithRetry } = await loadModule()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }))
    global.fetch = fetchMock as any

    const res = await paypalFetchWithRetry("https://api-m.paypal.com/x", { method: "POST" })

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("retries a 503 then succeeds", async () => {
    const { paypalFetchWithRetry } = await loadModule()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    global.fetch = fetchMock as any

    const res = await paypalFetchWithRetry("https://api-m.paypal.com/x", { method: "POST" })

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("retries on 429 (rate limited)", async () => {
    const { paypalFetchWithRetry } = await loadModule()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429))
      .mockResolvedValueOnce(jsonResponse(201, { id: "CAP-1" }))
    global.fetch = fetchMock as any

    const res = await paypalFetchWithRetry("https://api-m.paypal.com/x", { method: "POST" })

    expect(res.status).toBe(201)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("gives up after the max retries and returns the last error response", async () => {
    const { paypalFetchWithRetry } = await loadModule()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500))
    global.fetch = fetchMock as any

    const res = await paypalFetchWithRetry("https://api-m.paypal.com/x", { method: "POST" })

    // MAX_RETRIES = 2 → 3 total attempts.
    expect(res.status).toBe(500)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("does NOT retry a 4xx client error (e.g. 422)", async () => {
    const { paypalFetchWithRetry } = await loadModule()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(422, { name: "UNPROCESSABLE" }))
    global.fetch = fetchMock as any

    const res = await paypalFetchWithRetry("https://api-m.paypal.com/x", { method: "POST" })

    expect(res.status).toBe(422)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("retries a network timeout (AbortError) then succeeds", async () => {
    const { paypalFetchWithRetry } = await loadModule()
    const timeout = Object.assign(new Error("The operation was aborted"), {
      name: "TimeoutError",
    })
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    global.fetch = fetchMock as any

    const res = await paypalFetchWithRetry("https://api-m.paypal.com/x", { method: "POST" })

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe("paypalFetch circuit breaker", () => {
  const realFetch = global.fetch

  afterEach(() => {
    global.fetch = realFetch
  })

  it("opens after repeated 5xx failures and blocks further calls", async () => {
    const { paypalFetch } = await loadModule()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500))
    global.fetch = fetchMock as any

    // Threshold is 5 failures within the window.
    for (let i = 0; i < 5; i++) {
      await paypalFetch("https://api-m.paypal.com/x", { method: "GET" })
    }
    expect(fetchMock).toHaveBeenCalledTimes(5)

    // Next call should be short-circuited by the open breaker (no new fetch).
    await expect(
      paypalFetch("https://api-m.paypal.com/x", { method: "GET" })
    ).rejects.toThrow(/circuit breaker/i)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })
})
