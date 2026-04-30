import React, { useEffect, useRef, useState } from "react"
import PayPalTabs from "../_components/Tabs"

type AdminFetchOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
  body?: Record<string, unknown>
  query?: Record<string, string>
}

async function adminFetch<T = unknown>(path: string, opts: AdminFetchOptions = {}): Promise<T> {
  const { method = "GET", body, query } = opts
  let url = path
  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams(query)
    url = `${path}?${params.toString()}`
  }
  const headers: Record<string, string> = { Accept: "application/json" }
  if (body !== undefined) headers["Content-Type"] = "application/json"
  if (typeof window !== "undefined") {
    const token = (window as any).__medusa__?.token
    if (token) headers["Authorization"] = `Bearer ${token}`
  }
  const res = await fetch(url, {
    method, headers, credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text().catch(() => "")
  if (!res.ok) {
    if (res.status === 401) throw new Error("Unauthorized (401) - session may have expired. Please reload and log in again.")
    if (res.status === 403) throw new Error("Forbidden (403) - you do not have permission to perform this action.")
    throw new Error(text || `Request failed with status ${res.status}`)
  }
  if (!text) return {} as T
  try { return JSON.parse(text) as T } catch { return {} as T }
}

type PaymentAction = "capture" | "authorize"
type LandingPage = "no_preference" | "login" | "billing"

type AdditionalSettingsForm = {
  paymentAction: PaymentAction
  brandName: string
  landingPage: LandingPage
  requireInstantPayment: boolean
  sendItemDetails: boolean
  invoicePrefix: string
  creditCardStatementName: string
}

const DEFAULT_FORM: AdditionalSettingsForm = {
  paymentAction: "capture",
  brandName: "PayPal",
  landingPage: "no_preference",
  requireInstantPayment: false,
  sendItemDetails: true,
  invoicePrefix: "WC-",
  creditCardStatementName: "PayPal",
}

function mergeWithDefaults(saved?: Partial<AdditionalSettingsForm> | null) {
  if (!saved) return { ...DEFAULT_FORM }
  const entries = Object.entries(saved).filter(([, value]) => value !== undefined)
  return { ...DEFAULT_FORM, ...(Object.fromEntries(entries) as Partial<AdditionalSettingsForm>) }
}

function SectionCard({ title, description, right, children }: { title: string; description?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-ui-border-base bg-ui-bg-base shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-ui-border-base p-4">
        <div>
          <div className="text-base font-semibold text-ui-fg-base">{title}</div>
          {description ? <div className="mt-1 text-sm text-ui-fg-subtle">{description}</div> : null}
        </div>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function FieldRow({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-12 items-start gap-4 py-3">
      <div className="col-span-12 md:col-span-4">
        <div className="text-sm font-medium text-ui-fg-base">{label}</div>
        {hint ? <div className="mt-1 text-xs text-ui-fg-subtle">{hint}</div> : null}
      </div>
      <div className="col-span-12 md:col-span-8">{children}</div>
    </div>
  )
}

export default function AdditionalSettingsTab() {
  const [form, setForm] = useState<AdditionalSettingsForm>(() => ({ ...DEFAULT_FORM }))
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null)
  const didInit = useRef(false)

  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    ;(async () => {
      try {
        setLoading(true)
        const json = await adminFetch<any>("/admin/paypal/settings")
        const payload = json?.data ?? json
        const saved = payload?.additional_settings
        if (saved && typeof saved === "object") setForm(mergeWithDefaults(saved))
      } catch {
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function onSave() {
    try {
      setSaving(true)
      setToast(null)
      const json = await adminFetch<any>("/admin/paypal/settings", { method: "POST", body: { additional_settings: form as unknown as Record<string, unknown> } })
      const payload = json?.data ?? json
      const saved = payload?.additional_settings
      if (saved && typeof saved === "object") setForm(mergeWithDefaults(saved))
      setToast({ type: "success", message: "Settings saved" })
      window.setTimeout(() => setToast(null), 2500)
    } catch (e: unknown) {
      setToast({ type: "error", message: e instanceof Error ? e.message : "Failed to save settings" })
      window.setTimeout(() => setToast(null), 3500)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6">
      <div className="flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div><h1 className="text-xl font-semibold text-ui-fg-base">PayPal Gateway By Easy Payment</h1></div>
        </div>
        <PayPalTabs />
        {toast ? (
          <div className="fixed right-6 top-6 z-50 rounded-md border border-ui-border-base bg-ui-bg-base px-4 py-3 text-sm shadow-lg" role="status" aria-live="polite">
            <span className={toast.type === "success" ? "text-ui-fg-base" : "text-ui-fg-error"}>{toast.message}</span>
          </div>
        ) : null}
        <SectionCard
          title="Additional Settings"
          description="These settings control checkout behavior and PayPal experience."
          right={(
            <div className="flex items-center gap-3">
              <button type="button" onClick={onSave} disabled={saving || loading} className="transition-fg relative inline-flex w-fit items-center justify-center overflow-hidden rounded-md outline-none shadow-buttons-neutral text-ui-fg-base bg-ui-button-neutral after:transition-fg after:absolute after:inset-0 after:content-[''] after:button-neutral-gradient hover:bg-ui-button-neutral-hover hover:after:button-neutral-hover-gradient active:bg-ui-button-neutral-pressed active:after:button-neutral-pressed-gradient focus-visible:shadow-buttons-neutral-focus disabled:bg-ui-bg-disabled disabled:border-ui-border-base disabled:text-ui-fg-disabled disabled:shadow-buttons-neutral disabled:after:hidden txt-compact-small-plus px-3 py-1.5">
                {saving ? "Saving..." : "Save settings"}
              </button>
              {loading ? <span className="text-sm text-ui-fg-subtle">Loading...</span> : null}
            </div>
          )}
        >
          <div className="divide-y divide-ui-border-base">
            <FieldRow label="Payment action">
              <select value={form.paymentAction} onChange={(e) => setForm((p) => ({ ...p, paymentAction: e.target.value as PaymentAction }))} className="w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive">
                <option value="capture">Capture</option>
                <option value="authorize">Authorize</option>
              </select>
            </FieldRow>
            <FieldRow label="Brand Name">
              <input value={form.brandName} onChange={(e) => setForm((p) => ({ ...p, brandName: e.target.value }))} className="w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive" placeholder="PayPal" />
            </FieldRow>
            <FieldRow label="Landing Page">
              <select value={form.landingPage} onChange={(e) => setForm((p) => ({ ...p, landingPage: e.target.value as LandingPage }))} className="w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive">
                <option value="no_preference">No Preference</option>
                <option value="login">Login</option>
                <option value="billing">Billing</option>
              </select>
            </FieldRow>
            <FieldRow label="Instant Payments">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={form.requireInstantPayment} onChange={(e) => setForm((p) => ({ ...p, requireInstantPayment: e.target.checked }))} className="h-4 w-4 rounded border-ui-border-base" />
                <span className="text-sm text-ui-fg-base">Require Instant Payment</span>
              </label>
            </FieldRow>
            <FieldRow label="Send Item Details" hint="Include all line item details in the payment request to PayPal so that they can be seen from the PayPal transaction details page.">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={form.sendItemDetails} onChange={(e) => setForm((p) => ({ ...p, sendItemDetails: e.target.checked }))} className="h-4 w-4 rounded border-ui-border-base" />
                <span className="text-sm text-ui-fg-base">Send line item details to PayPal</span>
              </label>
            </FieldRow>
            <FieldRow label="Invoice prefix">
              <input value={form.invoicePrefix} onChange={(e) => setForm((p) => ({ ...p, invoicePrefix: e.target.value }))} className="w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive" placeholder="WC-" />
            </FieldRow>
            <FieldRow label="Credit Card Statement Name">
              <input value={form.creditCardStatementName} onChange={(e) => setForm((p) => ({ ...p, creditCardStatementName: e.target.value }))} className="w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive" placeholder="PayPal" />
            </FieldRow>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
