import React from "react"

export default function SectionCard({
  title,
  description,
  children,
  right,
}: {
  title: string
  description?: React.ReactNode
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
