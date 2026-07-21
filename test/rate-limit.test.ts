import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createRateLimiter } from "../src/api/utils/rate-limit"

function makeReqRes(ip = "1.2.3.4") {
  const req: any = { headers: {}, socket: { remoteAddress: ip } }
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as any,
    setHeader(k: string, v: string) {
      this.headers[k] = v
    },
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: any) {
      this.body = payload
      return this
    },
  }
  return { req, res }
}

describe("createRateLimiter", () => {
  beforeEach(() => {
    process.env.PAYPAL_RATE_LIMIT_MAX = "3"
    process.env.PAYPAL_RATE_LIMIT_WINDOW_MS = "60000"
  })

  afterEach(() => {
    delete process.env.PAYPAL_RATE_LIMIT_MAX
    delete process.env.PAYPAL_RATE_LIMIT_WINDOW_MS
  })

  it("is a no-op (opt-in) when PAYPAL_RATE_LIMIT_MAX is not set", () => {
    delete process.env.PAYPAL_RATE_LIMIT_MAX
    const limiter = createRateLimiter("create-order")

    // Far more requests than any limit — all pass through, none 429.
    for (let i = 0; i < 100; i++) {
      const { req, res } = makeReqRes()
      const next = vi.fn()
      limiter(req, res, next)
      expect(next).toHaveBeenCalledTimes(1)
      expect(res.statusCode).toBe(200)
    }
  })

  it("allows up to the limit then returns 429", () => {
    const limiter = createRateLimiter("create-order")

    for (let i = 0; i < 3; i++) {
      const { req, res } = makeReqRes()
      const next = vi.fn()
      limiter(req, res, next)
      expect(next).toHaveBeenCalledTimes(1)
      expect(res.statusCode).toBe(200)
    }

    // 4th request over the limit within the window.
    const { req, res } = makeReqRes()
    const next = vi.fn()
    limiter(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(429)
    expect(res.headers["Retry-After"]).toBeDefined()
  })

  it("tracks clients independently by IP", () => {
    const limiter = createRateLimiter("capture-order")

    // Exhaust client A.
    for (let i = 0; i < 3; i++) {
      const { req, res } = makeReqRes("10.0.0.1")
      limiter(req, res, vi.fn())
    }
    const a = makeReqRes("10.0.0.1")
    const aNext = vi.fn()
    limiter(a.req, a.res, aNext)
    expect(a.res.statusCode).toBe(429)

    // Client B is unaffected.
    const b = makeReqRes("10.0.0.2")
    const bNext = vi.fn()
    limiter(b.req, b.res, bNext)
    expect(bNext).toHaveBeenCalledTimes(1)
    expect(b.res.statusCode).toBe(200)
  })

  it("keys on the rightmost x-forwarded-for entry (proxy-appended, not client-forgeable)", () => {
    const limiter = createRateLimiter("paypal-complete")

    // The rightmost hop (10.0.0.1) is what the merchant's own proxy appended;
    // the left entries are client-supplied and forgeable.
    for (let i = 0; i < 3; i++) {
      const { req, res } = makeReqRes()
      req.headers["x-forwarded-for"] = "9.9.9.9, 10.0.0.1"
      limiter(req, res, vi.fn())
    }
    const { req, res } = makeReqRes()
    req.headers["x-forwarded-for"] = "8.8.8.8, 10.0.0.1"
    const next = vi.fn()
    limiter(req, res, next)
    // Same proxy-observed address despite a rotated (spoofed) left entry →
    // still limited.
    expect(res.statusCode).toBe(429)
    expect(next).not.toHaveBeenCalled()
  })

  it("cannot be bypassed by rotating the client-controlled leftmost entry", () => {
    const limiter = createRateLimiter("create-order")

    for (let i = 0; i < 4; i++) {
      const { req, res } = makeReqRes()
      req.headers["x-forwarded-for"] = `1.1.1.${i}, 10.0.0.9`
      const next = vi.fn()
      limiter(req, res, next)
      if (i < 3) {
        expect(res.statusCode).toBe(200)
      } else {
        expect(res.statusCode).toBe(429)
        expect(next).not.toHaveBeenCalled()
      }
    }
  })
})
