import React from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Navigate } from "react-router-dom"

export const config = defineRouteConfig({
  label: "PayPal",
})

const PayPalSettingsIndexRoute = () => {
  return <Navigate to="connection" replace />
}

export default PayPalSettingsIndexRoute
