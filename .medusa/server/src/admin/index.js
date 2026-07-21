"use strict";
const jsxRuntime = require("react/jsx-runtime");
const adminSdk = require("@medusajs/admin-sdk");
const reactRouterDom = require("react-router-dom");
const react = require("react");
const config$1 = adminSdk.defineRouteConfig({
  label: "PayPal"
});
const PayPalSettingsIndexRoute = () => {
  return /* @__PURE__ */ jsxRuntime.jsx(reactRouterDom.Navigate, { to: "connection", replace: true });
};
const BASE = "/settings/paypal";
const TABS = [
  { label: "PayPal Connection", to: `${BASE}/connection` },
  { label: "PayPal Settings", to: `${BASE}/paypal-settings` },
  { label: "Advanced Card Payments", to: `${BASE}/advanced-card-payments` },
  { label: "Additional Settings", to: `${BASE}/additional-settings` }
];
function isActive(pathname, to) {
  return pathname === to || pathname.startsWith(to + "/");
}
function PayPalTabs() {
  const { pathname } = reactRouterDom.useLocation();
  return /* @__PURE__ */ jsxRuntime.jsx("div", { className: "border-b border-ui-border-base", children: /* @__PURE__ */ jsxRuntime.jsx("div", { className: "flex flex-wrap gap-6 text-sm", children: TABS.map((t) => {
    const active = isActive(pathname, t.to);
    return /* @__PURE__ */ jsxRuntime.jsx(
      reactRouterDom.Link,
      {
        to: t.to,
        className: active ? "border-b-2 border-ui-fg-base pb-2 font-medium text-ui-fg-base" : "pb-2 text-ui-fg-subtle hover:text-ui-fg-base",
        children: t.label
      },
      t.to
    );
  }) }) });
}
function SectionCard({
  title,
  description,
  children,
  right
}) {
  return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "rounded-xl border border-ui-border-base bg-ui-bg-base shadow-sm", children: [
    /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "flex items-start justify-between gap-4 border-b border-ui-border-base p-4", children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "text-base font-semibold text-ui-fg-base", children: title }),
        description ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "mt-1 text-sm text-ui-fg-subtle", children: description }) : null
      ] }),
      right
    ] }),
    /* @__PURE__ */ jsxRuntime.jsx("div", { className: "p-4", children })
  ] });
}
function FieldRow({
  label,
  hint,
  htmlFor,
  children
}) {
  return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "grid grid-cols-12 items-start gap-4 py-3", children: [
    /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "col-span-12 md:col-span-4", children: [
      htmlFor ? /* @__PURE__ */ jsxRuntime.jsx("label", { htmlFor, className: "text-sm font-medium text-ui-fg-base", children: label }) : /* @__PURE__ */ jsxRuntime.jsx("div", { className: "text-sm font-medium text-ui-fg-base", children: label }),
      hint ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "mt-1 text-xs text-ui-fg-subtle", children: hint }) : null
    ] }),
    /* @__PURE__ */ jsxRuntime.jsx("div", { className: "col-span-12 md:col-span-8", children })
  ] });
}
function Toast({ toast, onClose }) {
  react.useEffect(() => {
    if (!toast) return;
    const duration = toast.kind === "error" ? 5e3 : 2500;
    const t = setTimeout(() => onClose(), duration);
    return () => clearTimeout(t);
  }, [toast, onClose]);
  if (!toast) return null;
  const isSuccess = toast.kind === "success";
  return /* @__PURE__ */ jsxRuntime.jsx("div", { className: "fixed right-6 top-6 z-[9999]", children: /* @__PURE__ */ jsxRuntime.jsx(
    "div",
    {
      className: [
        "min-w-[280px] max-w-[420px] rounded-lg border px-4 py-3 shadow-md",
        isSuccess ? "border-emerald-500/30 bg-emerald-500/10" : "border-rose-500/30 bg-rose-500/10"
      ].join(" "),
      role: isSuccess ? "status" : "alert",
      "aria-live": isSuccess ? "polite" : "assertive",
      children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "flex items-start gap-3", children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: ["mt-0.5 h-2.5 w-2.5 rounded-full", isSuccess ? "bg-emerald-500" : "bg-rose-500"].join(" ") }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "flex-1 text-sm text-ui-fg-base", children: toast.message }),
        /* @__PURE__ */ jsxRuntime.jsx(
          "button",
          {
            type: "button",
            onClick: onClose,
            className: "text-ui-fg-subtle hover:text-ui-fg-base",
            "aria-label": "Close",
            children: "×"
          }
        )
      ] })
    }
  ) });
}
async function adminFetch(path, opts = {}) {
  var _a;
  const { method = "GET", body, query } = opts;
  let url = path;
  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams(query);
    url = `${path}?${params.toString()}`;
  }
  const headers = { Accept: "application/json" };
  if (body !== void 0) headers["Content-Type"] = "application/json";
  if (typeof window !== "undefined") {
    const token = (_a = window.__medusa__) == null ? void 0 : _a.token;
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(url, {
    method,
    headers,
    credentials: "include",
    body: body !== void 0 ? JSON.stringify(body) : void 0
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    if (res.status === 401) throw new Error("Unauthorized (401) - session may have expired. Please reload and log in again.");
    if (res.status === 403) throw new Error("Forbidden (403) - you do not have permission to perform this action.");
    throw new Error(text || `Request failed with status ${res.status}`);
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
const DEFAULT_FORM$1 = {
  enabled: true,
  title: "Credit or Debit Card",
  threeDS: "when_required"
};
function mergeWithDefaults$1(saved) {
  if (!saved) return { ...DEFAULT_FORM$1 };
  const entries = Object.entries(saved).filter(([, value]) => value !== void 0);
  return { ...DEFAULT_FORM$1, ...Object.fromEntries(entries) };
}
const THREE_DS_OPTIONS = [
  { value: "when_required", label: "3D Secure when required", hint: "Triggers 3DS only when the card / issuer requires it." },
  { value: "sli", label: "3D Secure (SCA) / liability shift (recommended)", hint: "Attempts to optimize for liability shift while remaining compliant." },
  { value: "always", label: "Always request 3D Secure", hint: "Forces 3DS challenge whenever possible (may reduce conversion)." }
];
function AdvancedCardPaymentsTab() {
  var _a, _b;
  const [form, setForm] = react.useState(() => ({ ...DEFAULT_FORM$1 }));
  const [loading, setLoading] = react.useState(false);
  const [saving, setSaving] = react.useState(false);
  const [toast, setToast] = react.useState(null);
  const didInit = react.useRef(false);
  const dismissToast = react.useCallback(() => setToast(null), []);
  react.useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    (async () => {
      try {
        setLoading(true);
        const json = await adminFetch("/admin/paypal/settings");
        const payload = (json == null ? void 0 : json.data) ?? json;
        const saved = payload == null ? void 0 : payload.advanced_card_payments;
        if (saved && typeof saved === "object") setForm(mergeWithDefaults$1(saved));
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  async function onSave() {
    try {
      setSaving(true);
      const json = await adminFetch("/admin/paypal/settings", {
        method: "POST",
        body: { advanced_card_payments: form }
      });
      const payload = (json == null ? void 0 : json.data) ?? json;
      const saved = payload == null ? void 0 : payload.advanced_card_payments;
      if (saved && typeof saved === "object") setForm(mergeWithDefaults$1(saved));
      setToast({ kind: "success", message: "Settings saved" });
    } catch (e) {
      setToast({ kind: "error", message: (e instanceof Error ? e.message : "") || "Failed to save settings." });
    } finally {
      setSaving(false);
    }
  }
  return /* @__PURE__ */ jsxRuntime.jsx("div", { className: "p-6", children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "flex flex-col gap-6", children: [
    /* @__PURE__ */ jsxRuntime.jsx("div", { className: "flex items-start justify-between gap-4", children: /* @__PURE__ */ jsxRuntime.jsx("div", { children: /* @__PURE__ */ jsxRuntime.jsx("h1", { className: "text-xl font-semibold text-ui-fg-base", children: "PayPal Gateway By Easy Payment" }) }) }),
    /* @__PURE__ */ jsxRuntime.jsx(PayPalTabs, {}),
    /* @__PURE__ */ jsxRuntime.jsx(Toast, { toast, onClose: dismissToast }),
    /* @__PURE__ */ jsxRuntime.jsx(
      SectionCard,
      {
        title: "Advanced Card Payments",
        description: "Control card checkout settings and 3D Secure behavior.",
        right: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "flex items-center gap-3", children: [
          /* @__PURE__ */ jsxRuntime.jsx("button", { type: "button", onClick: onSave, disabled: saving || loading, className: "transition-fg relative inline-flex w-fit items-center justify-center overflow-hidden rounded-md outline-none shadow-buttons-neutral text-ui-fg-base bg-ui-button-neutral after:transition-fg after:absolute after:inset-0 after:content-[''] after:button-neutral-gradient hover:bg-ui-button-neutral-hover hover:after:button-neutral-hover-gradient active:bg-ui-button-neutral-pressed active:after:button-neutral-pressed-gradient focus-visible:shadow-buttons-neutral-focus disabled:bg-ui-bg-disabled disabled:border-ui-border-base disabled:text-ui-fg-disabled disabled:shadow-buttons-neutral disabled:after:hidden txt-compact-small-plus px-3 py-1.5", children: saving ? "Saving..." : "Save settings" }),
          loading ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: "text-sm text-ui-fg-subtle", children: "Loading…" }) : null
        ] }),
        children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "divide-y divide-ui-border-base", children: [
          /* @__PURE__ */ jsxRuntime.jsx(FieldRow, { label: "Enable/Disable", children: /* @__PURE__ */ jsxRuntime.jsxs("label", { className: "inline-flex items-center gap-2", children: [
            /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: form.enabled, onChange: (e) => setForm((p) => ({ ...p, enabled: e.target.checked })), className: "h-4 w-4 rounded border-ui-border-base" }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "text-sm text-ui-fg-base", children: "Enable Advanced Credit/Debit Card" })
          ] }) }),
          /* @__PURE__ */ jsxRuntime.jsx(FieldRow, { label: "Title", htmlFor: "acp-title", children: /* @__PURE__ */ jsxRuntime.jsx("input", { id: "acp-title", value: form.title, onChange: (e) => setForm((p) => ({ ...p, title: e.target.value })), className: "w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive", placeholder: "Credit or Debit Card" }) }),
          /* @__PURE__ */ jsxRuntime.jsx(FieldRow, { label: "Contingency for 3D Secure", hint: "Choose when 3D Secure should be triggered during card payments.", htmlFor: "acp-threeds", children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "flex flex-col gap-2", children: [
            /* @__PURE__ */ jsxRuntime.jsx("select", { id: "acp-threeds", value: form.threeDS, onChange: (e) => setForm((p) => ({ ...p, threeDS: e.target.value })), className: "w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive", children: THREE_DS_OPTIONS.map((o) => /* @__PURE__ */ jsxRuntime.jsx("option", { value: o.value, children: o.label }, o.value)) }),
            ((_a = THREE_DS_OPTIONS.find((o) => o.value === form.threeDS)) == null ? void 0 : _a.hint) ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "text-xs text-ui-fg-subtle", children: (_b = THREE_DS_OPTIONS.find((o) => o.value === form.threeDS)) == null ? void 0 : _b.hint }) : null
          ] }) })
        ] })
      }
    )
  ] }) });
}
const DEFAULT_FORM = {
  paymentAction: "capture",
  brandName: "PayPal",
  landingPage: "no_preference",
  requireInstantPayment: false,
  sendItemDetails: true,
  invoicePrefix: "PP-",
  creditCardStatementName: "PayPal"
};
function mergeWithDefaults(saved) {
  if (!saved) return { ...DEFAULT_FORM };
  const entries = Object.entries(saved).filter(([, value]) => value !== void 0);
  return { ...DEFAULT_FORM, ...Object.fromEntries(entries) };
}
function AdditionalSettingsTab() {
  const [form, setForm] = react.useState(() => ({ ...DEFAULT_FORM }));
  const [loading, setLoading] = react.useState(false);
  const [saving, setSaving] = react.useState(false);
  const [toast, setToast] = react.useState(null);
  const didInit = react.useRef(false);
  const dismissToast = react.useCallback(() => setToast(null), []);
  react.useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    (async () => {
      try {
        setLoading(true);
        const json = await adminFetch("/admin/paypal/settings");
        const payload = (json == null ? void 0 : json.data) ?? json;
        const saved = payload == null ? void 0 : payload.additional_settings;
        if (saved && typeof saved === "object") setForm(mergeWithDefaults(saved));
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  async function onSave() {
    try {
      setSaving(true);
      setToast(null);
      const json = await adminFetch("/admin/paypal/settings", { method: "POST", body: { additional_settings: form } });
      const payload = (json == null ? void 0 : json.data) ?? json;
      const saved = payload == null ? void 0 : payload.additional_settings;
      if (saved && typeof saved === "object") setForm(mergeWithDefaults(saved));
      setToast({ kind: "success", message: "Settings saved" });
    } catch (e) {
      setToast({ kind: "error", message: e instanceof Error ? e.message : "Failed to save settings" });
    } finally {
      setSaving(false);
    }
  }
  return /* @__PURE__ */ jsxRuntime.jsx("div", { className: "p-6", children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "flex flex-col gap-6", children: [
    /* @__PURE__ */ jsxRuntime.jsx("div", { className: "flex items-start justify-between gap-4", children: /* @__PURE__ */ jsxRuntime.jsx("div", { children: /* @__PURE__ */ jsxRuntime.jsx("h1", { className: "text-xl font-semibold text-ui-fg-base", children: "PayPal Gateway By Easy Payment" }) }) }),
    /* @__PURE__ */ jsxRuntime.jsx(PayPalTabs, {}),
    /* @__PURE__ */ jsxRuntime.jsx(Toast, { toast, onClose: dismissToast }),
    /* @__PURE__ */ jsxRuntime.jsx(
      SectionCard,
      {
        title: "Additional Settings",
        description: "These settings control checkout behavior and PayPal experience.",
        right: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "flex items-center gap-3", children: [
          /* @__PURE__ */ jsxRuntime.jsx("button", { type: "button", onClick: onSave, disabled: saving || loading, className: "transition-fg relative inline-flex w-fit items-center justify-center overflow-hidden rounded-md outline-none shadow-buttons-neutral text-ui-fg-base bg-ui-button-neutral after:transition-fg after:absolute after:inset-0 after:content-[''] after:button-neutral-gradient hover:bg-ui-button-neutral-hover hover:after:button-neutral-hover-gradient active:bg-ui-button-neutral-pressed active:after:button-neutral-pressed-gradient focus-visible:shadow-buttons-neutral-focus disabled:bg-ui-bg-disabled disabled:border-ui-border-base disabled:text-ui-fg-disabled disabled:shadow-buttons-neutral disabled:after:hidden txt-compact-small-plus px-3 py-1.5", children: saving ? "Saving..." : "Save settings" }),
          loading ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: "text-sm text-ui-fg-subtle", children: "Loading…" }) : null
        ] }),
        children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "divide-y divide-ui-border-base", children: [
          /* @__PURE__ */ jsxRuntime.jsx(FieldRow, { label: "Payment action", htmlFor: "as-payment-action", children: /* @__PURE__ */ jsxRuntime.jsxs("select", { id: "as-payment-action", value: form.paymentAction, onChange: (e) => setForm((p) => ({ ...p, paymentAction: e.target.value })), className: "w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive", children: [
            /* @__PURE__ */ jsxRuntime.jsx("option", { value: "capture", children: "Capture" }),
            /* @__PURE__ */ jsxRuntime.jsx("option", { value: "authorize", children: "Authorize" })
          ] }) }),
          /* @__PURE__ */ jsxRuntime.jsx(FieldRow, { label: "Brand Name", htmlFor: "as-brand-name", children: /* @__PURE__ */ jsxRuntime.jsx("input", { id: "as-brand-name", value: form.brandName, onChange: (e) => setForm((p) => ({ ...p, brandName: e.target.value })), className: "w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive", placeholder: "PayPal" }) }),
          /* @__PURE__ */ jsxRuntime.jsx(FieldRow, { label: "Landing Page", htmlFor: "as-landing-page", children: /* @__PURE__ */ jsxRuntime.jsxs("select", { id: "as-landing-page", value: form.landingPage, onChange: (e) => setForm((p) => ({ ...p, landingPage: e.target.value })), className: "w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive", children: [
            /* @__PURE__ */ jsxRuntime.jsx("option", { value: "no_preference", children: "No Preference" }),
            /* @__PURE__ */ jsxRuntime.jsx("option", { value: "login", children: "Login" }),
            /* @__PURE__ */ jsxRuntime.jsx("option", { value: "billing", children: "Billing" })
          ] }) }),
          /* @__PURE__ */ jsxRuntime.jsx(FieldRow, { label: "Instant Payments", children: /* @__PURE__ */ jsxRuntime.jsxs("label", { className: "inline-flex items-center gap-2", children: [
            /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: form.requireInstantPayment, onChange: (e) => setForm((p) => ({ ...p, requireInstantPayment: e.target.checked })), className: "h-4 w-4 rounded border-ui-border-base" }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "text-sm text-ui-fg-base", children: "Require Instant Payment" })
          ] }) }),
          /* @__PURE__ */ jsxRuntime.jsx(FieldRow, { label: "Send Item Details", hint: "Include all line item details in the payment request to PayPal so that they can be seen from the PayPal transaction details page.", children: /* @__PURE__ */ jsxRuntime.jsxs("label", { className: "inline-flex items-center gap-2", children: [
            /* @__PURE__ */ jsxRuntime.jsx("input", { type: "checkbox", checked: form.sendItemDetails, onChange: (e) => setForm((p) => ({ ...p, sendItemDetails: e.target.checked })), className: "h-4 w-4 rounded border-ui-border-base" }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "text-sm text-ui-fg-base", children: "Send line item details to PayPal" })
          ] }) }),
          /* @__PURE__ */ jsxRuntime.jsx(FieldRow, { label: "Invoice prefix", htmlFor: "as-invoice-prefix", children: /* @__PURE__ */ jsxRuntime.jsx("input", { id: "as-invoice-prefix", value: form.invoicePrefix, onChange: (e) => setForm((p) => ({ ...p, invoicePrefix: e.target.value })), className: "w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive", placeholder: "PP-" }) }),
          /* @__PURE__ */ jsxRuntime.jsx(FieldRow, { label: "Credit Card Statement Name", htmlFor: "as-cc-statement", children: /* @__PURE__ */ jsxRuntime.jsx("input", { id: "as-cc-statement", value: form.creditCardStatementName, onChange: (e) => setForm((p) => ({ ...p, creditCardStatementName: e.target.value })), className: "w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive", placeholder: "PayPal" }) })
        ] })
      }
    )
  ] }) });
}
function PayPalApplePayPage() {
  return /* @__PURE__ */ jsxRuntime.jsx(reactRouterDom.Navigate, { to: "/settings/paypal/connection", replace: true });
}
function PayPalGooglePayPage() {
  return /* @__PURE__ */ jsxRuntime.jsx(reactRouterDom.Navigate, { to: "/settings/paypal/connection", replace: true });
}
const config = adminSdk.defineRouteConfig({
  label: "PayPal Connection"
});
const PARTNER_JS_URL = "https://www.paypal.com/webapps/merchantboarding/js/lib/lightbox/partner.js";
const SERVICE_URL = "/admin/paypal/onboarding-link";
const CACHE_PREFIX = "pp_onboard_cache";
const CACHE_EXPIRY = 6 * 60 * 60 * 1e3;
const ONBOARDING_COMPLETE_ENDPOINT = "/admin/paypal/onboard-complete";
const STATUS_ENDPOINT = "/admin/paypal/status";
const SAVE_CREDENTIALS_ENDPOINT = "/admin/paypal/save-credentials";
const DISCONNECT_ENDPOINT = "/admin/paypal/disconnect";
const ENVIRONMENT_ENDPOINT = "/admin/paypal/environment";
const cacheKeyFor = (env) => `${CACHE_PREFIX}_${env}`;
function readCachedUrl(env) {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(cacheKeyFor(env));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && typeof data.url === "string" && Date.now() - (Number(data.ts) || 0) < CACHE_EXPIRY) {
      return data.url;
    }
  } catch {
  }
  return null;
}
function writeCachedUrl(env, url) {
  try {
    localStorage.setItem(cacheKeyFor(env), JSON.stringify({ url, ts: Date.now() }));
  } catch {
  }
}
function clearCachedUrl(env) {
  try {
    if (env) {
      localStorage.removeItem(cacheKeyFor(env));
    } else {
      localStorage.removeItem(cacheKeyFor("sandbox"));
      localStorage.removeItem(cacheKeyFor("live"));
    }
  } catch {
  }
}
function PayPalConnectionPage() {
  const [env, setEnv] = react.useState("live");
  const [envReady, setEnvReady] = react.useState(false);
  const [connState, setConnState] = react.useState("loading");
  const [error, setError] = react.useState(null);
  const [finalUrl, setFinalUrl] = react.useState("");
  const [showManual, setShowManual] = react.useState(false);
  const [clientId, setClientId] = react.useState("");
  const [secret, setSecret] = react.useState("");
  const [statusInfo, setStatusInfo] = react.useState(null);
  const [onboardingInProgress, setOnboardingInProgress] = react.useState(false);
  const initLoaderRef = react.useRef(null);
  const paypalButtonRef = react.useRef(null);
  const errorLogRef = react.useRef(null);
  const runIdRef = react.useRef(0);
  const currentRunId = react.useRef(0);
  const completedRef = react.useRef(false);
  const envRef = react.useRef(env);
  envRef.current = env;
  const pollTimerRef = react.useRef(null);
  const pollAttemptsRef = react.useRef(0);
  const ppBtnMeasureRef = react.useRef(null);
  const [ppBtnWidth, setPpBtnWidth] = react.useState(null);
  const canSaveManual = react.useMemo(() => {
    return clientId.trim().length > 0 && secret.trim().length > 0;
  }, [clientId, secret]);
  const showError = react.useCallback((msg) => {
    setConnState("error");
    setError(msg);
  }, []);
  const closeMiniBrowser = react.useCallback(() => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    try {
      const close1 = (_d = (_c = (_b = (_a = window.PAYPAL) == null ? void 0 : _a.apps) == null ? void 0 : _b.Signup) == null ? void 0 : _c.MiniBrowser) == null ? void 0 : _d.closeFlow;
      if (typeof close1 === "function") close1();
    } catch {
    }
    try {
      const close2 = (_h = (_g = (_f = (_e = window.PAYPAL) == null ? void 0 : _e.apps) == null ? void 0 : _f.Signup) == null ? void 0 : _g.miniBrowser) == null ? void 0 : _h.closeFlow;
      if (typeof close2 === "function") close2();
    } catch {
    }
  }, []);
  const stopStatusPolling = react.useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollAttemptsRef.current = 0;
  }, []);
  const refreshStatusAndMaybeConnect = react.useCallback(
    async (activeEnv) => {
      try {
        const res = await fetch(`${STATUS_ENDPOINT}?environment=${activeEnv}`, {
          method: "GET",
          credentials: "include"
        });
        const st = await res.json().catch(() => ({}));
        const connected = (st == null ? void 0 : st.status) === "connected" && (st == null ? void 0 : st.seller_client_id_present) === true;
        if (connected) {
          completedRef.current = true;
          setStatusInfo(st);
          setConnState("connected");
          setShowManual(false);
          setOnboardingInProgress(false);
          clearCachedUrl(activeEnv);
          closeMiniBrowser();
          stopStatusPolling();
        }
        return connected;
      } catch {
        return false;
      }
    },
    [closeMiniBrowser, stopStatusPolling]
  );
  const startStatusPolling = react.useCallback(() => {
    stopStatusPolling();
    const MAX_ATTEMPTS = 100;
    const tick = async () => {
      pollAttemptsRef.current += 1;
      const connected = await refreshStatusAndMaybeConnect(envRef.current);
      if (connected || completedRef.current) return;
      if (pollAttemptsRef.current >= MAX_ATTEMPTS) {
        stopStatusPolling();
        return;
      }
      pollTimerRef.current = setTimeout(tick, 3e3);
    };
    pollTimerRef.current = setTimeout(tick, 3e3);
  }, [refreshStatusAndMaybeConnect, stopStatusPolling]);
  const completeOnboarding = react.useCallback(
    async (authCode, sharedId) => {
      if (!authCode || !sharedId) return;
      if (completedRef.current) return;
      completedRef.current = true;
      try {
        window.onbeforeunload = null;
      } catch {
      }
      const activeEnv = envRef.current === "sandbox" ? "sandbox" : "live";
      setOnboardingInProgress(true);
      setConnState("loading");
      setError(null);
      try {
        const res = await fetch(ONBOARDING_COMPLETE_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ authCode, sharedId, env: activeEnv })
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(txt || `Onboarding exchange failed (${res.status})`);
        }
        closeMiniBrowser();
        clearCachedUrl(activeEnv);
        try {
          const statusRes = await fetch(
            `${STATUS_ENDPOINT}?environment=${activeEnv}`,
            { method: "GET", credentials: "include" }
          );
          const refreshedStatus = await statusRes.json().catch(() => ({}));
          setStatusInfo(refreshedStatus || null);
        } catch {
        }
        setConnState("connected");
        setShowManual(false);
        stopStatusPolling();
      } catch (e) {
        completedRef.current = false;
        console.error(e);
        setConnState("error");
        setError((e == null ? void 0 : e.message) || "Exchange failed while saving credentials.");
      } finally {
        setOnboardingInProgress(false);
      }
    },
    [closeMiniBrowser, stopStatusPolling]
  );
  const initPartner = react.useCallback(() => {
    var _a, _b;
    const signup = (_b = (_a = window.PAYPAL) == null ? void 0 : _a.apps) == null ? void 0 : _b.Signup;
    const init = (signup == null ? void 0 : signup.miniBrowser) && signup.miniBrowser.init || (signup == null ? void 0 : signup.MiniBrowser) && signup.MiniBrowser.init;
    if (typeof init === "function") {
      try {
        init();
      } catch (e) {
        console.error("[paypal] partner.js init failed:", e);
      }
    }
  }, []);
  react.useEffect(() => {
    const existingScript = document.getElementById("paypal-partner-js");
    if (existingScript) return;
    const preloadHref = PARTNER_JS_URL;
    let preloadLink = null;
    if (!document.head.querySelector(`link[rel="preload"][href="${preloadHref}"]`)) {
      preloadLink = document.createElement("link");
      preloadLink.rel = "preload";
      preloadLink.href = preloadHref;
      preloadLink.as = "script";
      document.head.appendChild(preloadLink);
    }
    const ppScript = document.createElement("script");
    ppScript.id = "paypal-partner-js";
    ppScript.src = preloadHref;
    ppScript.async = true;
    document.head.appendChild(ppScript);
    return () => {
      if (preloadLink == null ? void 0 : preloadLink.parentNode) preloadLink.parentNode.removeChild(preloadLink);
      if (ppScript.parentNode) ppScript.parentNode.removeChild(ppScript);
    };
  }, []);
  const activatePayPal = react.useCallback(
    (url, runId) => {
      if (paypalButtonRef.current) {
        paypalButtonRef.current.href = url;
      }
      setFinalUrl(url);
      let attempts = 0;
      const MAX_ATTEMPTS = 200;
      const tryInit = () => {
        var _a, _b;
        if (runId !== currentRunId.current) return;
        if ((_b = (_a = window.PAYPAL) == null ? void 0 : _a.apps) == null ? void 0 : _b.Signup) {
          initPartner();
          setConnState("ready");
          return;
        }
        attempts++;
        if (attempts >= MAX_ATTEMPTS) {
          showError(
            "PayPal partner script failed to load. Please refresh and try again."
          );
          return;
        }
        setTimeout(tryInit, 50);
      };
      tryInit();
    },
    [initPartner, showError]
  );
  const fetchFreshLink = react.useCallback(
    async (targetEnv, runId) => {
      if (initLoaderRef.current) {
        const loaderText = initLoaderRef.current.querySelector("#loader-text");
        if (loaderText) loaderText.textContent = "Generating onboarding session...";
      }
      try {
        const res = await fetch(SERVICE_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ products: ["PPCP"], environment: targetEnv })
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error((data == null ? void 0 : data.message) || `Service returned ${res.status}`);
        }
        if (runId !== currentRunId.current) return;
        const href = data == null ? void 0 : data.onboarding_url;
        if (!href) {
          showError("Onboarding URL not returned.");
          return;
        }
        const url = href + (href.includes("?") ? "&" : "?") + "displayMode=minibrowser";
        writeCachedUrl(targetEnv, url);
        activatePayPal(url, runId);
      } catch (err) {
        if (runId !== currentRunId.current) return;
        showError((err == null ? void 0 : err.message) || "Unable to connect to service.");
      }
    },
    [activatePayPal, showError]
  );
  react.useEffect(() => {
    let alive = true;
    fetch(ENVIRONMENT_ENDPOINT, { method: "GET", credentials: "include" }).then((r) => r.json()).then((d) => {
      if (!alive) return;
      setEnv((d == null ? void 0 : d.environment) === "sandbox" ? "sandbox" : "live");
    }).catch(() => {
    }).finally(() => {
      if (alive) setEnvReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  react.useEffect(() => {
    if (!envReady) return;
    currentRunId.current = ++runIdRef.current;
    const runId = currentRunId.current;
    let cancelled = false;
    completedRef.current = false;
    const run = async () => {
      setConnState("loading");
      setError(null);
      setFinalUrl("");
      try {
        const r = await fetch(`${STATUS_ENDPOINT}?environment=${env}`, {
          method: "GET",
          credentials: "include"
        });
        const st = await r.json().catch(() => ({}));
        if (cancelled || runId !== currentRunId.current) return;
        setStatusInfo(st);
        const isConnected = (st == null ? void 0 : st.status) === "connected" && (st == null ? void 0 : st.seller_client_id_present) === true;
        if (isConnected) {
          setConnState("connected");
          setShowManual(false);
          return;
        }
      } catch (e) {
        console.error(e);
      }
      if (cancelled || runId !== currentRunId.current) return;
      const cached = readCachedUrl(env);
      if (cached) {
        activatePayPal(cached, runId);
        return;
      }
      await fetchFreshLink(env, runId);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [env, envReady, fetchFreshLink, activatePayPal]);
  react.useLayoutEffect(() => {
    window.onboardingCallback = (authCode, sharedId) => {
      void completeOnboarding(authCode, sharedId);
    };
    return () => {
      window.onboardingCallback = void 0;
    };
  }, [completeOnboarding]);
  react.useEffect(() => {
    const onMessage = (event) => {
      const data = event == null ? void 0 : event.data;
      if (!data || data.source !== "paypal-onboarding-return") return;
      const params = data.params || {};
      const authCode = params.authCode || params.auth_code;
      const sharedId = params.sharedId || params.shared_id;
      const activeEnv = envRef.current;
      void (async () => {
        const connected = await refreshStatusAndMaybeConnect(activeEnv);
        if (!connected && authCode && sharedId) {
          await completeOnboarding(authCode, sharedId);
        }
      })();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [completeOnboarding, refreshStatusAndMaybeConnect]);
  react.useEffect(() => stopStatusPolling, [stopStatusPolling]);
  react.useLayoutEffect(() => {
    const el = ppBtnMeasureRef.current;
    if (!el) return;
    const update = () => {
      const w = Math.round(el.getBoundingClientRect().width || 0);
      if (w > 0) setPpBtnWidth(w);
    };
    update();
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => update());
      ro.observe(el);
    } else {
      window.addEventListener("resize", update);
    }
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", update);
    };
  }, [connState, env, finalUrl]);
  const handleConnectClick = (e) => {
    if (connState !== "ready" || !finalUrl || onboardingInProgress) {
      e.preventDefault();
      return;
    }
    completedRef.current = false;
    startStatusPolling();
  };
  const handleSaveManual = async () => {
    if (!canSaveManual || onboardingInProgress) return;
    setOnboardingInProgress(true);
    setConnState("loading");
    setError(null);
    try {
      const res = await fetch(SAVE_CREDENTIALS_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          clientId: clientId.trim(),
          clientSecret: secret.trim(),
          environment: env
        })
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `Save credentials failed (${res.status})`);
      }
      const statusRes = await fetch(`${STATUS_ENDPOINT}?environment=${env}`, {
        method: "GET",
        credentials: "include"
      });
      const refreshedStatus = await statusRes.json().catch(() => ({}));
      setConnState("connected");
      setStatusInfo(refreshedStatus || null);
      setShowManual(false);
      clearCachedUrl(env);
    } catch (e) {
      console.error(e);
      setConnState("error");
      setError((e == null ? void 0 : e.message) || "Failed to save credentials.");
    } finally {
      setOnboardingInProgress(false);
    }
  };
  const handleDisconnect = async () => {
    if (onboardingInProgress) return;
    if (!window.confirm("Disconnect PayPal for this environment?")) return;
    stopStatusPolling();
    setOnboardingInProgress(true);
    setConnState("loading");
    setError(null);
    setFinalUrl("");
    setShowManual(false);
    setStatusInfo(null);
    try {
      const res = await fetch(DISCONNECT_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ environment: env })
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `Disconnect failed (${res.status})`);
      }
      clearCachedUrl(env);
      completedRef.current = false;
      currentRunId.current = ++runIdRef.current;
      await fetchFreshLink(env, currentRunId.current);
    } catch (e) {
      console.error(e);
      setConnState("error");
      setError((e == null ? void 0 : e.message) || "Failed to disconnect.");
    } finally {
      setOnboardingInProgress(false);
    }
  };
  const handleEnvChange = async (e) => {
    const next = e.target.value;
    if (next === env || onboardingInProgress) return;
    stopStatusPolling();
    completedRef.current = false;
    clearCachedUrl();
    setConnState("loading");
    try {
      await fetch(ENVIRONMENT_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ environment: next })
      });
    } catch {
    }
    setEnv(next);
  };
  return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "p-6", children: [
    /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "flex flex-col gap-6", children: [
      /* @__PURE__ */ jsxRuntime.jsx("div", { className: "flex items-start justify-between gap-4", children: /* @__PURE__ */ jsxRuntime.jsx("div", { children: /* @__PURE__ */ jsxRuntime.jsx("h1", { className: "text-xl font-semibold text-ui-fg-base", children: "PayPal Gateway By Easy Payment" }) }) }),
      /* @__PURE__ */ jsxRuntime.jsx(PayPalTabs, {}),
      /* @__PURE__ */ jsxRuntime.jsx("div", { className: "rounded-xl border border-ui-border-base bg-ui-bg-base shadow-sm", children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "grid grid-cols-1 gap-y-6 p-4 md:grid-cols-[260px_1fr] md:items-start", children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "text-sm font-medium pt-2", children: "Environment" }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "max-w-xl", children: /* @__PURE__ */ jsxRuntime.jsxs(
          "select",
          {
            value: env,
            onChange: handleEnvChange,
            disabled: onboardingInProgress,
            className: "w-full rounded-md border border-ui-border-base bg-transparent px-3 py-2 text-sm",
            children: [
              /* @__PURE__ */ jsxRuntime.jsx("option", { value: "sandbox", children: "Sandbox (Test Mode)" }),
              /* @__PURE__ */ jsxRuntime.jsx("option", { value: "live", children: "Live (Production)" })
            ]
          }
        ) }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "text-sm font-medium pt-2", children: env === "sandbox" ? "Connect to PayPal (Sandbox)" : "Connect to PayPal" }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "max-w-xl", children: connState === "connected" ? /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "text-sm text-green-600 bg-green-50 p-3 rounded border border-green-200", children: [
            "✅ Successfully connected to PayPal!",
            /* @__PURE__ */ jsxRuntime.jsx(
              "a",
              {
                "data-paypal-button": "true",
                "data-paypal-onboard-complete": "onboardingCallback",
                href: "#",
                style: { display: "none" },
                children: "PayPal"
              }
            )
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "mt-3 rounded-md border border-ui-border-base bg-ui-bg-subtle p-3 text-xs text-ui-fg-subtle", children: [
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "font-medium text-ui-fg-base", children: "Connected PayPal account" }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "mt-1", children: [
              "Email:",
              " ",
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "font-mono text-ui-fg-base", children: (statusInfo == null ? void 0 : statusInfo.seller_email) || "Unavailable" })
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "mt-3 flex items-center gap-2", children: /* @__PURE__ */ jsxRuntime.jsx(
            "button",
            {
              type: "button",
              onClick: handleDisconnect,
              disabled: onboardingInProgress,
              className: "transition-fg relative inline-flex w-fit items-center justify-center overflow-hidden rounded-md outline-none shadow-buttons-neutral text-ui-fg-base bg-ui-button-neutral after:transition-fg after:absolute after:inset-0 after:content-[''] after:button-neutral-gradient hover:bg-ui-button-neutral-hover hover:after:button-neutral-hover-gradient active:bg-ui-button-neutral-pressed active:after:button-neutral-pressed-gradient focus-visible:shadow-buttons-neutral-focus disabled:bg-ui-bg-disabled disabled:border-ui-border-base disabled:text-ui-fg-disabled disabled:shadow-buttons-neutral disabled:after:hidden txt-compact-small-plus px-3 py-1.5",
              children: "Disconnect"
            }
          ) })
        ] }) : /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
          /* @__PURE__ */ jsxRuntime.jsxs(
            "div",
            {
              ref: initLoaderRef,
              id: "init-loader",
              className: `status-msg mb-4 ${connState !== "loading" ? "hidden" : "block"}`,
              children: [
                /* @__PURE__ */ jsxRuntime.jsx("div", { className: "loader inline-block align-middle mr-2" }),
                /* @__PURE__ */ jsxRuntime.jsx("span", { id: "loader-text", className: "text-sm", children: onboardingInProgress ? "Configuring connection to PayPal…" : "Checking connection..." })
              ]
            }
          ),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: `${connState === "ready" ? "block" : "hidden"}`, children: [
            /* @__PURE__ */ jsxRuntime.jsx(
              "a",
              {
                ref: (node) => {
                  paypalButtonRef.current = node;
                  ppBtnMeasureRef.current = node;
                },
                id: "paypal-button",
                "data-paypal-button": "true",
                href: finalUrl || "#",
                "data-paypal-onboard-complete": "onboardingCallback",
                onClick: handleConnectClick,
                className: "transition-fg relative inline-flex w-fit items-center justify-center overflow-hidden rounded-md outline-none no-underline shadow-buttons-neutral text-ui-fg-base bg-ui-button-neutral after:transition-fg after:absolute after:inset-0 after:content-[''] after:button-neutral-gradient hover:bg-ui-button-neutral-hover hover:after:button-neutral-hover-gradient active:bg-ui-button-neutral-pressed active:after:button-neutral-pressed-gradient focus-visible:shadow-buttons-neutral-focus disabled:bg-ui-bg-disabled disabled:border-ui-border-base disabled:text-ui-fg-disabled disabled:shadow-buttons-neutral disabled:after:hidden txt-compact-small-plus px-3 py-1.5",
                style: {
                  cursor: onboardingInProgress ? "not-allowed" : "pointer",
                  opacity: onboardingInProgress ? 0.6 : 1,
                  pointerEvents: onboardingInProgress ? "none" : "auto"
                },
                children: "Connect to PayPal"
              }
            ),
            /* @__PURE__ */ jsxRuntime.jsx(
              "div",
              {
                className: "mt-2",
                style: {
                  width: ppBtnWidth ? `${ppBtnWidth}px` : "auto",
                  marginTop: "20px",
                  marginBottom: "10px"
                },
                children: /* @__PURE__ */ jsxRuntime.jsx("div", { className: "flex justify-center", children: /* @__PURE__ */ jsxRuntime.jsx("span", { className: "text-[11px] text-ui-fg-muted leading-none", children: "OR" }) })
              }
            ),
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "mt-1", children: /* @__PURE__ */ jsxRuntime.jsx(
              "button",
              {
                type: "button",
                onClick: () => setShowManual(!showManual),
                disabled: onboardingInProgress,
                className: "text-sm text-ui-fg-interactive underline whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed",
                children: "Click here to insert credentials manually"
              }
            ) })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: `${connState === "ready" ? "hidden" : "block"} mt-3`, children: /* @__PURE__ */ jsxRuntime.jsx(
            "button",
            {
              type: "button",
              onClick: () => setShowManual(!showManual),
              disabled: onboardingInProgress,
              className: "text-sm text-ui-fg-interactive underline whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed",
              children: "Click here to insert credentials manually"
            }
          ) }),
          /* @__PURE__ */ jsxRuntime.jsx(
            "div",
            {
              ref: errorLogRef,
              id: "error-log",
              className: `mt-4 text-left text-xs bg-red-50 text-red-600 p-3 border border-red-200 rounded ${connState === "error" && error ? "block" : "hidden"}`,
              children: error
            }
          )
        ] }) }),
        showManual && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "md:col-span-2", children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "ml-[260px] max-w-xl mt-4 grid grid-cols-1 gap-3 md:grid-cols-2", children: [
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "flex flex-col gap-1", children: [
            /* @__PURE__ */ jsxRuntime.jsx("label", { htmlFor: "pp-manual-client-id", className: "text-sm font-medium", children: "Client ID" }),
            /* @__PURE__ */ jsxRuntime.jsx(
              "input",
              {
                id: "pp-manual-client-id",
                type: "text",
                value: clientId,
                onChange: (e) => setClientId(e.target.value),
                disabled: onboardingInProgress,
                className: "rounded-md border border-ui-border-base bg-transparent px-3 py-2 text-sm disabled:opacity-50",
                placeholder: env === "sandbox" ? "Sandbox Client ID" : "Live Client ID"
              }
            )
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "flex flex-col gap-1", children: [
            /* @__PURE__ */ jsxRuntime.jsx("label", { htmlFor: "pp-manual-secret", className: "text-sm font-medium", children: "Secret" }),
            /* @__PURE__ */ jsxRuntime.jsx(
              "input",
              {
                id: "pp-manual-secret",
                type: "password",
                value: secret,
                onChange: (e) => setSecret(e.target.value),
                disabled: onboardingInProgress,
                className: "rounded-md border border-ui-border-base bg-transparent px-3 py-2 text-sm disabled:opacity-50",
                placeholder: env === "sandbox" ? "Sandbox Secret" : "Live Secret"
              }
            )
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "md:col-span-2 rounded-md border border-ui-border-base bg-ui-bg-subtle p-4 text-sm text-ui-fg-subtle", children: [
            /* @__PURE__ */ jsxRuntime.jsx("p", { className: "font-medium text-ui-fg-base", children: "Get your Client ID and Secret in 3 steps:" }),
            /* @__PURE__ */ jsxRuntime.jsxs("ol", { className: "mt-2 list-decimal space-y-2 pl-5", children: [
              /* @__PURE__ */ jsxRuntime.jsxs("li", { children: [
                "Open",
                " ",
                /* @__PURE__ */ jsxRuntime.jsx(
                  "a",
                  {
                    href: "https://developer.paypal.com/dashboard/",
                    target: "_blank",
                    rel: "noreferrer",
                    className: "text-ui-fg-interactive underline",
                    children: "Log in to Dashboard"
                  }
                ),
                " ",
                "and sign in or create an account."
              ] }),
              /* @__PURE__ */ jsxRuntime.jsxs("li", { children: [
                "Select ",
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "font-medium text-ui-fg-base", children: "Apps & Credentials" }),
                ", then choose ",
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "font-medium text-ui-fg-base", children: "Create App" }),
                " if you need a new project."
              ] }),
              /* @__PURE__ */ jsxRuntime.jsxs("li", { children: [
                "Copy your app's ",
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "font-medium text-ui-fg-base", children: "Client ID" }),
                " and ",
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "font-medium text-ui-fg-base", children: "Secret" }),
                ", paste them above, then click ",
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "font-medium text-ui-fg-base", children: "Save credentials" }),
                "."
              ] })
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "md:col-span-2 flex items-center gap-2 mt-2", children: [
            /* @__PURE__ */ jsxRuntime.jsx(
              "button",
              {
                type: "button",
                className: "transition-fg relative inline-flex w-fit items-center justify-center overflow-hidden rounded-md outline-none shadow-buttons-neutral text-ui-fg-base bg-ui-button-neutral after:transition-fg after:absolute after:inset-0 after:content-[''] after:button-neutral-gradient hover:bg-ui-button-neutral-hover hover:after:button-neutral-hover-gradient active:bg-ui-button-neutral-pressed active:after:button-neutral-pressed-gradient focus-visible:shadow-buttons-neutral-focus disabled:bg-ui-bg-disabled disabled:border-ui-border-base disabled:text-ui-fg-disabled disabled:shadow-buttons-neutral disabled:after:hidden txt-compact-small-plus px-3 py-1.5",
                onClick: () => setShowManual(false),
                disabled: onboardingInProgress,
                children: "Cancel"
              }
            ),
            /* @__PURE__ */ jsxRuntime.jsx(
              "button",
              {
                type: "button",
                className: "transition-fg relative inline-flex w-fit items-center justify-center overflow-hidden rounded-md outline-none shadow-buttons-neutral text-ui-fg-base bg-ui-button-neutral after:transition-fg after:absolute after:inset-0 after:content-[''] after:button-neutral-gradient hover:bg-ui-button-neutral-hover hover:after:button-neutral-hover-gradient active:bg-ui-button-neutral-pressed active:after:button-neutral-pressed-gradient focus-visible:shadow-buttons-neutral-focus disabled:bg-ui-bg-disabled disabled:border-ui-border-base disabled:text-ui-fg-disabled disabled:shadow-buttons-neutral disabled:after:hidden txt-compact-small-plus px-3 py-1.5",
                disabled: !canSaveManual || onboardingInProgress,
                onClick: handleSaveManual,
                children: "Save credentials"
              }
            )
          ] })
        ] }) })
      ] }) })
    ] }),
    /* @__PURE__ */ jsxRuntime.jsx("style", { children: `
        .loader {
          border: 3px solid #f3f3f3;
          border-top: 3px solid #0070ba;
          border-radius: 50%;
          width: 18px;
          height: 18px;
          animation: spin 1s linear infinite;
          display: inline-block;
          vertical-align: middle;
          margin-right: 8px;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      ` })
  ] });
}
function PayPalPayLaterMessagingPage() {
  return /* @__PURE__ */ jsxRuntime.jsx(reactRouterDom.Navigate, { to: "/settings/paypal/connection", replace: true });
}
const COLOR_OPTIONS = [
  { value: "gold", label: "Gold (Recommended)" },
  { value: "blue", label: "Blue" },
  { value: "silver", label: "Silver" },
  { value: "black", label: "Black" },
  { value: "white", label: "White" }
];
const SHAPE_OPTIONS = [
  { value: "rect", label: "Rect (Recommended)" },
  { value: "pill", label: "Pill" }
];
const WIDTH_OPTIONS = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "responsive", label: "Responsive" }
];
const HEIGHT_OPTIONS = [32, 36, 40, 44, 48, 52, 56];
const LABEL_OPTIONS = [
  { value: "paypal", label: "PayPal" },
  { value: "checkout", label: "Checkout" },
  { value: "buynow", label: "Buy Now" },
  { value: "pay", label: "Pay" }
];
function PayPalSettingsTab() {
  const [form, setForm] = react.useState({
    enabled: true,
    title: "PayPal",
    description: "Pay via PayPal; you can pay with your credit card if you don't have a PayPal account",
    buttonColor: "gold",
    buttonShape: "rect",
    buttonWidth: "medium",
    buttonHeight: 48,
    buttonLabel: "paypal"
  });
  const [loading, setLoading] = react.useState(false);
  const [saving, setSaving] = react.useState(false);
  const [toast, setToast] = react.useState(null);
  const didInit = react.useRef(false);
  const dismissToast = react.useCallback(() => setToast(null), []);
  react.useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    (async () => {
      try {
        setLoading(true);
        const json = await adminFetch(
          "/admin/paypal/settings"
        );
        const payload = (json == null ? void 0 : json.data) ?? json;
        const saved = payload == null ? void 0 : payload.paypal_settings;
        if (saved && typeof saved === "object") {
          setForm((prev) => ({
            ...prev,
            ...saved
          }));
        }
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  async function onSave() {
    try {
      setSaving(true);
      const cleaned = { ...form };
      const json = await adminFetch(
        "/admin/paypal/settings",
        {
          method: "POST",
          body: { paypal_settings: cleaned }
        }
      );
      const payload = (json == null ? void 0 : json.data) ?? json;
      const saved = payload == null ? void 0 : payload.paypal_settings;
      if (saved && typeof saved === "object") {
        setForm((prev) => ({
          ...prev,
          ...saved
        }));
      }
      setToast({ kind: "success", message: "Settings saved" });
    } catch (e) {
      setToast({
        kind: "error",
        message: (e instanceof Error ? e.message : "") || "Failed to save settings."
      });
    } finally {
      setSaving(false);
    }
  }
  return /* @__PURE__ */ jsxRuntime.jsx("div", { className: "p-6", children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "flex flex-col gap-6", children: [
    /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "flex items-start justify-between gap-4", children: [
      /* @__PURE__ */ jsxRuntime.jsx("div", { children: /* @__PURE__ */ jsxRuntime.jsx("h1", { className: "text-xl font-semibold text-ui-fg-base", children: "PayPal Gateway By Easy Payment" }) }),
      /* @__PURE__ */ jsxRuntime.jsx("div", { className: "flex items-center gap-2" })
    ] }),
    /* @__PURE__ */ jsxRuntime.jsx(PayPalTabs, {}),
    /* @__PURE__ */ jsxRuntime.jsx(Toast, { toast, onClose: dismissToast }),
    /* @__PURE__ */ jsxRuntime.jsx(
      SectionCard,
      {
        title: "PayPal Settings",
        description: "Enable PayPal and configure checkout title.",
        right: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "flex items-center gap-3", children: [
          /* @__PURE__ */ jsxRuntime.jsx(
            "button",
            {
              type: "button",
              onClick: onSave,
              disabled: saving || loading,
              className: "transition-fg relative inline-flex w-fit items-center justify-center overflow-hidden rounded-md outline-none shadow-buttons-neutral text-ui-fg-base bg-ui-button-neutral after:transition-fg after:absolute after:inset-0 after:content-[''] after:button-neutral-gradient hover:bg-ui-button-neutral-hover hover:after:button-neutral-hover-gradient active:bg-ui-button-neutral-pressed active:after:button-neutral-pressed-gradient focus-visible:shadow-buttons-neutral-focus disabled:bg-ui-bg-disabled disabled:border-ui-border-base disabled:text-ui-fg-disabled disabled:shadow-buttons-neutral disabled:after:hidden txt-compact-small-plus px-3 py-1.5",
              children: saving ? "Saving..." : "Save settings"
            }
          ),
          loading ? /* @__PURE__ */ jsxRuntime.jsx("span", { className: "text-sm text-ui-fg-subtle", children: "Loading…" }) : null
        ] }),
        children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "divide-y divide-ui-border-base", children: [
          /* @__PURE__ */ jsxRuntime.jsx(FieldRow, { label: "Enable/Disable", children: /* @__PURE__ */ jsxRuntime.jsxs("label", { className: "inline-flex items-center gap-2", children: [
            /* @__PURE__ */ jsxRuntime.jsx(
              "input",
              {
                type: "checkbox",
                checked: form.enabled,
                onChange: (e) => setForm((p) => ({ ...p, enabled: e.target.checked })),
                className: "h-4 w-4 rounded border-ui-border-base"
              }
            ),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "text-sm text-ui-fg-base", children: "Enable PayPal" })
          ] }) }),
          /* @__PURE__ */ jsxRuntime.jsx(FieldRow, { label: "Title", htmlFor: "pp-title", children: /* @__PURE__ */ jsxRuntime.jsx(
            "input",
            {
              id: "pp-title",
              value: form.title,
              onChange: (e) => setForm((p) => ({ ...p, title: e.target.value })),
              className: "w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive",
              placeholder: "PayPal"
            }
          ) })
        ] })
      }
    ),
    /* @__PURE__ */ jsxRuntime.jsx(
      SectionCard,
      {
        title: "Button Appearance",
        description: "Control PayPal Smart Button styling (color/shape/size/label).",
        children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "divide-y divide-ui-border-base", children: [
          /* @__PURE__ */ jsxRuntime.jsx(FieldRow, { label: "Button Color", htmlFor: "pp-btn-color", children: /* @__PURE__ */ jsxRuntime.jsx(
            "select",
            {
              id: "pp-btn-color",
              value: form.buttonColor,
              onChange: (e) => setForm((p) => ({ ...p, buttonColor: e.target.value })),
              className: "w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive",
              children: COLOR_OPTIONS.map((o) => /* @__PURE__ */ jsxRuntime.jsx("option", { value: o.value, children: o.label }, o.value))
            }
          ) }),
          /* @__PURE__ */ jsxRuntime.jsx(FieldRow, { label: "Button Shape", htmlFor: "pp-btn-shape", children: /* @__PURE__ */ jsxRuntime.jsx(
            "select",
            {
              id: "pp-btn-shape",
              value: form.buttonShape,
              onChange: (e) => setForm((p) => ({ ...p, buttonShape: e.target.value })),
              className: "w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive",
              children: SHAPE_OPTIONS.map((o) => /* @__PURE__ */ jsxRuntime.jsx("option", { value: o.value, children: o.label }, o.value))
            }
          ) }),
          /* @__PURE__ */ jsxRuntime.jsx(FieldRow, { label: "Button Width", htmlFor: "pp-btn-width", children: /* @__PURE__ */ jsxRuntime.jsx(
            "select",
            {
              id: "pp-btn-width",
              value: form.buttonWidth,
              onChange: (e) => setForm((p) => ({ ...p, buttonWidth: e.target.value })),
              className: "w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive",
              children: WIDTH_OPTIONS.map((o) => /* @__PURE__ */ jsxRuntime.jsx("option", { value: o.value, children: o.label }, o.value))
            }
          ) }),
          /* @__PURE__ */ jsxRuntime.jsx(FieldRow, { label: "Button Height", htmlFor: "pp-btn-height", children: /* @__PURE__ */ jsxRuntime.jsx(
            "select",
            {
              id: "pp-btn-height",
              value: String(form.buttonHeight),
              onChange: (e) => setForm((p) => ({ ...p, buttonHeight: Number(e.target.value) })),
              className: "w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive",
              children: HEIGHT_OPTIONS.map((h) => /* @__PURE__ */ jsxRuntime.jsxs("option", { value: h, children: [
                h,
                " px"
              ] }, h))
            }
          ) }),
          /* @__PURE__ */ jsxRuntime.jsx(FieldRow, { label: "Button Label", htmlFor: "pp-btn-label", children: /* @__PURE__ */ jsxRuntime.jsx(
            "select",
            {
              id: "pp-btn-label",
              value: form.buttonLabel,
              onChange: (e) => setForm((p) => ({ ...p, buttonLabel: e.target.value })),
              className: "w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive",
              children: LABEL_OPTIONS.map((o) => /* @__PURE__ */ jsxRuntime.jsx("option", { value: o.value, children: o.label }, o.value))
            }
          ) })
        ] })
      }
    )
  ] }) });
}
const widgetModule = { widgets: [] };
const routeModule = {
  routes: [
    {
      Component: PayPalSettingsIndexRoute,
      path: "/settings/paypal"
    },
    {
      Component: AdvancedCardPaymentsTab,
      path: "/settings/paypal/advanced-card-payments"
    },
    {
      Component: AdditionalSettingsTab,
      path: "/settings/paypal/additional-settings"
    },
    {
      Component: PayPalApplePayPage,
      path: "/settings/paypal/apple-pay"
    },
    {
      Component: PayPalGooglePayPage,
      path: "/settings/paypal/google-pay"
    },
    {
      Component: PayPalConnectionPage,
      path: "/settings/paypal/connection"
    },
    {
      Component: PayPalPayLaterMessagingPage,
      path: "/settings/paypal/pay-later-messaging"
    },
    {
      Component: PayPalSettingsTab,
      path: "/settings/paypal/paypal-settings"
    }
  ]
};
const menuItemModule = {
  menuItems: [
    {
      label: config$1.label,
      icon: void 0,
      path: "/settings/paypal",
      nested: void 0,
      rank: void 0,
      translationNs: void 0
    },
    {
      label: config.label,
      icon: void 0,
      path: "/settings/paypal/connection",
      nested: void 0,
      rank: void 0,
      translationNs: void 0
    }
  ]
};
const formModule = { customFields: {} };
const displayModule = {
  displays: {}
};
const i18nModule = { resources: {} };
const plugin = {
  widgetModule,
  routeModule,
  menuItemModule,
  formModule,
  displayModule,
  i18nModule
};
module.exports = plugin;
