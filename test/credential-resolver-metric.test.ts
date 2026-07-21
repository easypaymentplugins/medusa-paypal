import { describe, it, expect, vi } from "vitest"
import { PayPalCredentialResolver } from "../src/modules/paypal/utils/credential-resolver"

/**
 * recordMetric must be a single atomic upsert (INSERT ... ON CONFLICT ... count
 * = count + 1), not a read-modify-write, so concurrent captures/refunds don't
 * lose metric increments.
 */
describe("PayPalCredentialResolver.recordMetric", () => {
  it("performs a single atomic upsert (no read-then-write)", async () => {
    const raw = vi.fn().mockResolvedValue(undefined)
    // A db that would throw if used as a query builder — proving recordMetric
    // never does a separate SELECT/UPDATE round-trip.
    const db: any = () => {
      throw new Error("query builder should not be used by recordMetric")
    }
    db.raw = raw

    const resolver = new PayPalCredentialResolver(db)
    await resolver.recordMetric("capture_success")

    expect(raw).toHaveBeenCalledTimes(1)
    const sql = String(raw.mock.calls[0][0])
    expect(sql).toMatch(/insert into paypal_metric/i)
    expect(sql).toMatch(/on conflict/i)
    // The increment happens in SQL, not in JS.
    expect(sql).toMatch(/count.*\+ 1/i)
  })

  it("passes the metric name and merges metadata via bindings", async () => {
    const raw = vi.fn().mockResolvedValue(undefined)
    const db: any = () => {
      throw new Error("unused")
    }
    db.raw = raw

    const resolver = new PayPalCredentialResolver(db)
    await resolver.recordMetric("refund_success", { currency_code: "EUR" })

    const bindings = raw.mock.calls[0][1] as any[]
    expect(bindings).toContain("refund_success")
    // metadata is serialized into the bindings for the jsonb merge.
    expect(bindings.some((b) => typeof b === "string" && b.includes("EUR"))).toBe(true)
  })

  it("never throws even if the DB call fails (metrics must not break payments)", async () => {
    const raw = vi.fn().mockRejectedValue(new Error("db down"))
    const db: any = () => {
      throw new Error("unused")
    }
    db.raw = raw

    const resolver = new PayPalCredentialResolver(db)
    await expect(resolver.recordMetric("capture_success")).resolves.toBeUndefined()
  })
})
