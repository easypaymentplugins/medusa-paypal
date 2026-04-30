import { Module } from "@medusajs/framework/utils"
import PayPalModuleService from "./service"

export const PAYPAL_MODULE = "paypal_onboarding"

export default Module(PAYPAL_MODULE, {
  service: PayPalModuleService,
})
