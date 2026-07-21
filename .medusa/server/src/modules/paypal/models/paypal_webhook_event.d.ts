declare const PayPalWebhookEvent: import("@medusajs/framework/utils").DmlEntity<import("@medusajs/framework/utils").DMLEntitySchemaBuilder<{
    id: import("@medusajs/framework/utils").PrimaryKeyModifier<string, import("@medusajs/framework/utils").IdProperty>;
    event_id: import("@medusajs/framework/utils").TextProperty;
    event_type: import("@medusajs/framework/utils").TextProperty;
    event_version: import("@medusajs/framework/utils").NullableModifier<string, import("@medusajs/framework/utils").TextProperty>;
    transmission_id: import("@medusajs/framework/utils").NullableModifier<string, import("@medusajs/framework/utils").TextProperty>;
    transmission_time: import("@medusajs/framework/utils").NullableModifier<Date, import("@medusajs/framework/utils").DateTimeProperty>;
    status: import("@medusajs/framework/utils").TextProperty;
    attempt_count: import("@medusajs/framework/utils").NumberProperty;
    next_retry_at: import("@medusajs/framework/utils").NullableModifier<Date, import("@medusajs/framework/utils").DateTimeProperty>;
    processed_at: import("@medusajs/framework/utils").NullableModifier<Date, import("@medusajs/framework/utils").DateTimeProperty>;
    last_error: import("@medusajs/framework/utils").NullableModifier<string, import("@medusajs/framework/utils").TextProperty>;
    resource_id: import("@medusajs/framework/utils").NullableModifier<string, import("@medusajs/framework/utils").TextProperty>;
    payload: import("@medusajs/framework/utils").JSONProperty;
}>, "paypal_webhook_event">;
export default PayPalWebhookEvent;
//# sourceMappingURL=paypal_webhook_event.d.ts.map