"use strict";
/**
 * Outbound HTTP for PayPal API calls with timeout, circuit breaker, and
 * optional retry for critical payment operations.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAYPAL_HTTP_TIMEOUT_MS = void 0;
exports.paypalFetch = paypalFetch;
exports.paypalFetchWithRetry = paypalFetchWithRetry;
exports.PAYPAL_HTTP_TIMEOUT_MS = (() => {
    const v = Number(process.env.PAYPAL_HTTP_TIMEOUT_MS);
    return Number.isFinite(v) && v > 0 ? v : 30_000;
})();
// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------
const CB_FAILURE_THRESHOLD = 5;
const CB_WINDOW_MS = 30_000;
const CB_HALF_OPEN_MS = 60_000;
const breakers = new Map();
function cbHostKey(input) {
    try {
        return new URL(String(input)).host || "default";
    }
    catch {
        return "default";
    }
}
function getBreaker(host) {
    let b = breakers.get(host);
    if (!b) {
        b = { state: "closed", failures: [], openedAt: 0, halfOpenProbeInFlight: false };
        breakers.set(host, b);
    }
    return b;
}
function cbRecordSuccess(host) {
    const b = getBreaker(host);
    b.state = "closed";
    b.failures = [];
    b.halfOpenProbeInFlight = false;
}
function cbRecordFailure(host) {
    const b = getBreaker(host);
    b.halfOpenProbeInFlight = false;
    const now = Date.now();
    b.failures = b.failures.filter((t) => now - t < CB_WINDOW_MS);
    b.failures.push(now);
    if (b.failures.length >= CB_FAILURE_THRESHOLD) {
        b.state = "open";
        b.openedAt = now;
        console.warn(`[PayPal] circuit breaker OPEN for ${host} after ${CB_FAILURE_THRESHOLD} failures in ${CB_WINDOW_MS / 1000}s`);
    }
}
function cbAllowRequest(host) {
    const b = getBreaker(host);
    if (b.state === "closed")
        return true;
    if (b.state === "open") {
        if (Date.now() - b.openedAt >= CB_HALF_OPEN_MS) {
            b.state = "half-open";
            b.halfOpenProbeInFlight = true;
            return true;
        }
        return false;
    }
    // half-open: allow only one probe at a time
    if (b.halfOpenProbeInFlight)
        return false;
    b.halfOpenProbeInFlight = true;
    return true;
}
class CircuitOpenError extends Error {
    constructor() {
        super("PayPal circuit breaker is open — API calls are temporarily blocked after repeated failures. Will retry automatically.");
        this.name = "CircuitOpenError";
    }
}
// ---------------------------------------------------------------------------
// Core fetch with timeout + circuit breaker
// ---------------------------------------------------------------------------
function paypalFetch(input, init = {}) {
    const host = cbHostKey(input);
    if (!cbAllowRequest(host)) {
        return Promise.reject(new CircuitOpenError());
    }
    const fetchPromise = init.signal
        ? fetch(input, init)
        : fetch(input, {
            ...init,
            signal: AbortSignal.timeout(exports.PAYPAL_HTTP_TIMEOUT_MS),
        });
    return fetchPromise.then((res) => {
        if (res.status >= 500) {
            cbRecordFailure(host);
        }
        else {
            cbRecordSuccess(host);
        }
        return res;
    }, (err) => {
        cbRecordFailure(host);
        throw err;
    });
}
// ---------------------------------------------------------------------------
// Retry wrapper for critical payment operations (capture, refund)
// ---------------------------------------------------------------------------
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;
function jitteredDelay(attempt) {
    const base = BASE_DELAY_MS * Math.pow(2, attempt);
    return base + Math.random() * base;
}
function isRetryable(err) {
    if (err instanceof CircuitOpenError)
        return true;
    if (err instanceof Error) {
        if (err.name === "TimeoutError" || err.name === "AbortError")
            return true;
    }
    return false;
}
function isRetryableStatus(status) {
    return status >= 500 || status === 429;
}
async function paypalFetchWithRetry(input, init = {}) {
    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const res = await paypalFetch(input, init);
            if (isRetryableStatus(res.status) && attempt < MAX_RETRIES) {
                const delay = jitteredDelay(attempt);
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }
            return res;
        }
        catch (err) {
            lastError = err;
            if (!isRetryable(err) || attempt >= MAX_RETRIES)
                throw err;
            const delay = jitteredDelay(attempt);
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    throw lastError;
}
//# sourceMappingURL=paypal-fetch.js.map