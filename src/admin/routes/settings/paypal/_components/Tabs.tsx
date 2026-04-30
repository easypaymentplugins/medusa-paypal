import React from "react"
import { Link, useLocation } from "react-router-dom"

type Tab = {
  label: string
  to: string
}

const BASE = "/settings/paypal"

const TABS: Tab[] = [
  { label: "PayPal Connection", to: `${BASE}/connection` },
  { label: "PayPal Settings", to: `${BASE}/paypal-settings` },
  { label: "Advanced Card Payments", to: `${BASE}/advanced-card-payments` },
  { label: "Additional Settings", to: `${BASE}/additional-settings` },
]

function isActive(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(to + "/")
}

export default function PayPalTabs() {
  const { pathname } = useLocation()

  return (
    <div className="border-b border-ui-border-base">
      <div className="flex flex-wrap gap-6 text-sm">
        {TABS.map((t) => {
          const active = isActive(pathname, t.to)

          return (
            <Link
              key={t.to}
              to={t.to}
              className={
                active
                  ? "border-b-2 border-ui-fg-base pb-2 font-medium text-ui-fg-base"
                  : "pb-2 text-ui-fg-subtle hover:text-ui-fg-base"
              }
            >
              {t.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
