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

type ThreeDSContingency = "sli" | "when_required" | "always"

type AdvancedCardPaymentsForm = {
  enabled: boolean
  title: string
  threeDS: ThreeDSContingency
}

const DEFAULT_FORM: AdvancedCardPaymentsForm = {
  enabled: true,
  title: "Credit or Debit Card",
  threeDS: "when_required",
}

function mergeWithDefaults(saved?: Partial<AdvancedCardPaymentsForm> | null) {
  if (!saved) return { ...DEFAULT_FORM }
  const entries = Object.entries(saved).filter(([, value]) => value !== undefined)
  return { ...DEFAULT_FORM, ...(Object.fromEntries(entries) as Partial<AdvancedCardPaymentsForm>) }
}

const THREE_DS_OPTIONS: { value: ThreeDSContingency; label: string; hint?: string }[] = [
  { value: "when_required", label: "3D Secure when required", hint: "Triggers 3DS only when the card / issuer requires it." },
  { value: "sli", label: "3D Secure (SCA) / liability shift (recommended)", hint: "Attempts to optimize for liability shift while remaining compliant." },
  { value: "always", label: "Always request 3D Secure", hint: "Forces 3DS challenge whenever possible (may reduce conversion)." },
]

function SectionCard({ title, description, right, children }: { title: string; description?: string; right?: React.ReactNode; children: React.ReactNode }) {
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

export default function AdvancedCardPaymentsTab() {
  const [form, setForm] = useState<AdvancedCardPaymentsForm>(() => ({ ...DEFAULT_FORM }))
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
        const saved = payload?.advanced_card_payments
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
      const json = await adminFetch<any>("/admin/paypal/settings", {
        method: "POST",
        body: { advanced_card_payments: form as unknown as Record<string, unknown> },
      })
      const payload = json?.data ?? json
      const saved = payload?.advanced_card_payments
      if (saved && typeof saved === "object") setForm(mergeWithDefaults(saved))
      setToast({ type: "success", message: "Settings saved" })
      window.setTimeout(() => setToast(null), 2500)
    } catch (e: unknown) {
      setToast({ type: "error", message: (e instanceof Error ? e.message : "") || "Failed to save settings." })
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
          title="Advanced Card Payments"
          description="Control card checkout settings and 3D Secure behavior."
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
            <FieldRow label="Enable/Disable">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))} className="h-4 w-4 rounded border-ui-border-base" />
                <span className="text-sm text-ui-fg-base">Enable Advanced Credit/Debit Card</span>
              </label>
            </FieldRow>
            <FieldRow label="Title">
              <input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} className="w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive" placeholder="Credit or Debit Card" />
            </FieldRow>
            <FieldRow label="Contingency for 3D Secure" hint="Choose when 3D Secure should be triggered during card payments.">
              <div className="flex flex-col gap-2">
                <select value={form.threeDS} onChange={(e) => setForm((p) => ({ ...p, threeDS: e.target.value as ThreeDSContingency }))} className="w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive">
                  {THREE_DS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {THREE_DS_OPTIONS.find((o) => o.value === form.threeDS)?.hint
                  ? <div className="text-xs text-ui-fg-subtle">{THREE_DS_OPTIONS.find((o) => o.value === form.threeDS)?.hint}</div>
                  : null}
              </div>
            </FieldRow>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}