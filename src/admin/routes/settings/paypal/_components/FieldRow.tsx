import React from "react"

export default function FieldRow({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string
  hint?: React.ReactNode
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-12 items-start gap-4 py-3">
      <div className="col-span-12 md:col-span-4">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium text-ui-fg-base">
            {label}
          </label>
        ) : (
          <div className="text-sm font-medium text-ui-fg-base">{label}</div>
        )}
        {hint ? <div className="mt-1 text-xs text-ui-fg-subtle">{hint}</div> : null}
      </div>
      <div className="col-span-12 md:col-span-8">{children}</div>
    </div>
  )
}
