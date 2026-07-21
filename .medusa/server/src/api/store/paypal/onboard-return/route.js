"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
/**
 * Public PayPal onboarding `return_url`.
 *
 * When a seller finishes onboarding, PayPal redirects the mini-browser popup to
 * this URL as a plain top-level navigation (no auth header / no publishable key),
 * which is why it must live under the public `/store/paypal/*` namespace rather
 * than `/admin/*`. Leaving the popup on a raw JSON / 401 / 405 page is exactly
 * what made the popup appear to "never close".
 *
 * This route is the authoritative, partner.js-independent completion path. It:
 *   1. exchanges PayPal's `authCode` + `sharedId` for seller credentials
 *      server-side (idempotent — safe even if partner.js's onboardingCallback or
 *      admin status polling also completes the exchange),
 *   2. relays whatever query params PayPal appended back to the opener (the
 *      Medusa Admin connection page) via postMessage so it can refresh
 *      immediately, and
 *   3. closes the popup.
 *
 * Because the exchange no longer depends on the opener receiving an in-flight
 * postMessage, onboarding completes (and the admin page flips to "connected" via
 * its status poll) even when partner.js never fires its callback.
 */
async function GET(req, res) {
    const query = (req.query || {});
    const params = {};
    for (const [k, v] of Object.entries(query)) {
        if (v == null)
            continue;
        params[k] = Array.isArray(v) ? String(v[0]) : String(v);
    }
    // PayPal appends the seller's authorization code + shared id to the return_url
    // (plus the env we pinned when generating the link). When present, complete the
    // exchange right here so credentials are saved even if no other path runs.
    const authCode = params.authCode || params.auth_code;
    const sharedId = params.sharedId || params.shared_id;
    const env = params.env === "sandbox" || params.env === "live" ? params.env : undefined;
    if (authCode && sharedId) {
        try {
            const paypal = req.scope.resolve("paypal_onboarding");
            await paypal.exchangeAndSaveSellerCredentials({ authCode, sharedId, env });
        }
        catch (e) {
            // Don't break the popup close on failure — relay the params so the opener
            // (partner.js / admin polling) can still attempt to complete.
            console.error("[PayPal] onboard-return exchange failed:", e instanceof Error ? e.message : e);
        }
    }
    // Restrict the postMessage target to the configured admin origin instead of
    // the "*" wildcard (which would deliver the relayed onboarding params to any
    // origin that happens to open this popup). Prefer PAYPAL_ADMIN_ORIGIN, then
    // the first entry of ADMIN_CORS; fall back to "*" only when neither is set,
    // logging a warning so operators know to lock it down.
    const resolveAdminOrigin = () => {
        const explicit = (process.env.PAYPAL_ADMIN_ORIGIN || "").trim();
        if (explicit)
            return explicit;
        const firstCors = (process.env.ADMIN_CORS || "")
            .split(",")
            .map((s) => s.trim())
            .find(Boolean);
        if (firstCors)
            return firstCors;
        console.warn("[PayPal] onboard-return: PAYPAL_ADMIN_ORIGIN/ADMIN_CORS not set \u2014 relaying onboarding result to postMessage origin '*'. Set PAYPAL_ADMIN_ORIGIN to your admin URL to restrict it.");
        return "*";
    };
    const targetOrigin = resolveAdminOrigin();
    // JSON-encode then escape the characters that could break out of the inline
    // <script> string/tag (including the U+2028/U+2029 separators that are legal in
    // JSON but illegal in a JS string literal), so the relayed params embed safely.
    const escapeForScript = (value) => value
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026")
        .replace(/[\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
    const safePayload = escapeForScript(JSON.stringify(params));
    const safeTargetOrigin = escapeForScript(JSON.stringify(targetOrigin));
    const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>PayPal onboarding complete</title></head>
<body style="font-family: system-ui, sans-serif; padding: 24px; text-align: center; color: #1f2937;">
<p>PayPal onboarding complete. You can close this window.</p>
<script>
(function () {
  try {
    var message = { source: "paypal-onboarding-return", params: ${safePayload} };
    var targetOrigin = ${safeTargetOrigin};
    if (window.opener && !window.opener.closed) {
      try { window.opener.postMessage(message, targetOrigin); } catch (e) {}
    }
  } catch (e) {}
  // Give the opener a moment to react, then close the popup.
  setTimeout(function () { try { window.close(); } catch (e) {} }, 600);
})();
</script>
</body>
</html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(html);
}
//# sourceMappingURL=route.js.map