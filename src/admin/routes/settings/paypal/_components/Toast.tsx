import React, { useEffect } from "react"

export type ToastKind = "success" | "error"

export type ToastState = {
  kind: ToastKind
  message: string
} | null

type Props = {
  toast: ToastState
  onClose: () => void
}

export default function Toast({ toast, onClose }: Props) {
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => onClose(), 2500)
    return () => clearTimeout(t)
  }, [toast, onClose])

  if (!toast) return null

  const isSuccess = toast.kind === "success"

  return (
    <div className="fixed right-6 top-6 z-[9999]">
      <div
        className={[
          "min-w-[280px] max-w-[420px] rounded-lg border px-4 py-3 shadow-md",
          isSuccess ? "border-emerald-500/30 bg-emerald-500/10" : "border-rose-500/30 bg-rose-500/10",
        ].join(" ")}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <div className={["mt-0.5 h-2.5 w-2.5 rounded-full", isSuccess ? "bg-emerald-500" : "bg-rose-500"].join(" ")} />
          <div className="flex-1 text-sm text-ui-fg-base">{toast.message}</div>
          <button
            type="button"
            onClick={onClose}
            className="text-ui-fg-subtle hover:text-ui-fg-base"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  )
}
