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

type ButtonColor = "gold" | "blue" | "silver" | "black" | "white"
type ButtonShape = "rect" | "pill"
type ButtonWidth = "small" | "medium" | "large" | "responsive"
type ButtonLabel = "paypal" | "checkout" | "buynow" | "pay"

type PayPalSettingsForm = {
  enabled: boolean
  title: string
  description: string
  buttonColor: ButtonColor
  buttonShape: ButtonShape
  buttonWidth: ButtonWidth
  buttonHeight: number
  buttonLabel: ButtonLabel
}

const COLOR_OPTIONS: { value: ButtonColor; label: string }[] = [
  { value: "gold", label: "Gold (Recommended)" },
  { value: "blue", label: "Blue" },
  { value: "silver", label: "Silver" },
  { value: "black", label: "Black" },
  { value: "white", label: "White" },
]

const SHAPE_OPTIONS: { value: ButtonShape; label: string }[] = [
  { value: "rect", label: "Rect (Recommended)" },
  { value: "pill", label: "Pill" },
]

const WIDTH_OPTIONS: { value: ButtonWidth; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "responsive", label: "Responsive" },
]

const HEIGHT_OPTIONS: number[] = [32, 36, 40, 44, 48, 52, 56]

const LABEL_OPTIONS: { value: ButtonLabel; label: string }[] = [
  { value: "paypal", label: "PayPal" },
  { value: "checkout", label: "Checkout" },
  { value: "buynow", label: "Buy Now" },
  { value: "pay", label: "Pay" },
]

function SectionCard({
  title,
  description,
  children,
  right,
}: {
  title: string
  description?: string
  children: React.ReactNode
  right?: React.ReactNode
}) {
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

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: React.ReactNode
  children: React.ReactNode
}) {
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

export default function PayPalSettingsTab() {
  const [form, setForm] = useState<PayPalSettingsForm>({
    enabled: true,
    title: "PayPal",
    description: "Pay via PayPal; you can pay with your credit card if you don't have a PayPal account",
    buttonColor: "gold",
    buttonShape: "rect",
    buttonWidth: "medium",
    buttonHeight: 48,
    buttonLabel: "paypal",
  })
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
        const json = await adminFetch<{ data?: { paypal_settings?: PayPalSettingsForm }; paypal_settings?: PayPalSettingsForm }>(
          "/admin/paypal/settings"
        )
        const payload = (json?.data ?? json) as any
        const saved = payload?.paypal_settings
        if (saved && typeof saved === "object") {
          setForm((prev) => ({
            ...prev,
            ...saved,
          }))
        }
      } catch {
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function onSave() {
    try {
      setSaving(true)
      const cleaned = { ...form }
      const json = await adminFetch<{ data?: { paypal_settings?: PayPalSettingsForm }; paypal_settings?: PayPalSettingsForm }>(
        "/admin/paypal/settings",
        {
          method: "POST",
          body: { paypal_settings: cleaned as unknown as Record<string, unknown> },
        }
      )
      const payload = (json?.data ?? json) as any
      const saved = payload?.paypal_settings
      if (saved && typeof saved === "object") {
        setForm((prev) => ({
          ...prev,
          ...saved,
        }))
      }
      setToast({ type: "success", message: "Settings saved" })
      window.setTimeout(() => setToast(null), 2500)
    } catch (e: unknown) {
      setToast({
        type: "error",
        message:
          (e instanceof Error ? e.message : "") ||
          "Failed to save settings.",
      })
      window.setTimeout(() => setToast(null), 3500)
    } finally {
      setSaving(false)
    }
  }


  return (
    <div className="p-6">
      <div className="flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-ui-fg-base">PayPal Gateway By Easy Payment</h1>
          </div>
          <div className="flex items-center gap-2">
          </div>
        </div>

        <PayPalTabs />

        {toast ? (
          <div
            className="fixed right-6 top-6 z-50 rounded-md border border-ui-border-base bg-ui-bg-base px-4 py-3 text-sm shadow-lg"
            role="status"
            aria-live="polite"
          >
            <span className={toast.type === "success" ? "text-ui-fg-base" : "text-ui-fg-error"}>
              {toast.message}
            </span>
          </div>
        ) : null}

        <SectionCard
          title="PayPal Settings"
          description="Enable PayPal and configure checkout title."
          right={(
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onSave}
                disabled={saving || loading}
                className="transition-fg relative inline-flex w-fit items-center justify-center overflow-hidden rounded-md outline-none shadow-buttons-neutral text-ui-fg-base bg-ui-button-neutral after:transition-fg after:absolute after:inset-0 after:content-[''] after:button-neutral-gradient hover:bg-ui-button-neutral-hover hover:after:button-neutral-hover-gradient active:bg-ui-button-neutral-pressed active:after:button-neutral-pressed-gradient focus-visible:shadow-buttons-neutral-focus disabled:bg-ui-bg-disabled disabled:border-ui-border-base disabled:text-ui-fg-disabled disabled:shadow-buttons-neutral disabled:after:hidden txt-compact-small-plus px-3 py-1.5"
              >
                {saving ? "Saving..." : "Save settings"}
              </button>
              {loading ? <span className="text-sm text-ui-fg-subtle">Loading…</span> : null}
            </div>
          )}
        >
          <div className="divide-y divide-ui-border-base">
            <FieldRow label="Enable/Disable">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))}
                  className="h-4 w-4 rounded border-ui-border-base"
                />
                <span className="text-sm text-ui-fg-base">Enable PayPal</span>
              </label>
            </FieldRow>

            <FieldRow label="Title">
              <input
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                className="w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive"
                placeholder="PayPal"
              />
            </FieldRow>

          </div>
        </SectionCard>

        <SectionCard
          title="Button Appearance"
          description="Control PayPal Smart Button styling (color/shape/size/label)."
        >
          <div className="divide-y divide-ui-border-base">

            <FieldRow label="Button Color">
              <select
                value={form.buttonColor}
                onChange={(e) => setForm((p) => ({ ...p, buttonColor: e.target.value as ButtonColor }))}
                className="w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive"
              >
                {COLOR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </FieldRow>

            <FieldRow label="Button Shape">
              <select
                value={form.buttonShape}
                onChange={(e) => setForm((p) => ({ ...p, buttonShape: e.target.value as ButtonShape }))}
                className="w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive"
              >
                {SHAPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </FieldRow>

            <FieldRow label="Button Width">
              <select
                value={form.buttonWidth}
                onChange={(e) => setForm((p) => ({ ...p, buttonWidth: e.target.value as ButtonWidth }))}
                className="w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive"
              >
                {WIDTH_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </FieldRow>

            <FieldRow label="Button Height">
              <select
                value={String(form.buttonHeight)}
                onChange={(e) => setForm((p) => ({ ...p, buttonHeight: Number(e.target.value) }))}
                className="w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive"
              >
                {HEIGHT_OPTIONS.map((h) => (
                  <option key={h} value={h}>
                    {h} px
                  </option>
                ))}
              </select>
            </FieldRow>

            <FieldRow label="Button Label">
              <select
                value={form.buttonLabel}
                onChange={(e) => setForm((p) => ({ ...p, buttonLabel: e.target.value as ButtonLabel }))}
                className="w-full rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-sm text-ui-fg-base outline-none focus:ring-2 focus:ring-ui-border-interactive"
              >
                {LABEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </FieldRow>
          </div>
        </SectionCard>

      </div>
    </div>
  )
}
