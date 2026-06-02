import React, { useCallback, useEffect, useRef, useState } from "react"
import PayPalTabs from "../_components/Tabs"
import SectionCard from "../_components/SectionCard"
import FieldRow from "../_components/FieldRow"
import Toast, { ToastState } from "../_components/Toast"
import { adminFetch } from "../_utils/adminFetch"

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
  const [toast, setToast] = useState<ToastState>(null)
  const didInit = useRef(false)

  const dismissToast = useCallback(() => setToast(null), [])

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
      setToast({ kind: "success", message: "Settings saved" })
    } catch (e: unknown) {
      setToast({
        kind: "error",
        message:
          (e instanceof Error ? e.message : "") ||
          "Failed to save settings.",
      })
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

        <Toast toast={toast} onClose={dismissToast} />

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

            <FieldRow label="Title" htmlFor="pp-title">
              <input
                id="pp-title"
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

            <FieldRow label="Button Color" htmlFor="pp-btn-color">
              <select
                id="pp-btn-color"
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

            <FieldRow label="Button Shape" htmlFor="pp-btn-shape">
              <select
                id="pp-btn-shape"
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

            <FieldRow label="Button Width" htmlFor="pp-btn-width">
              <select
                id="pp-btn-width"
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

            <FieldRow label="Button Height" htmlFor="pp-btn-height">
              <select
                id="pp-btn-height"
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

            <FieldRow label="Button Label" htmlFor="pp-btn-label">
              <select
                id="pp-btn-label"
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
