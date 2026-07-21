import PayPalModuleService from "./service";
export declare const PAYPAL_MODULE = "paypal_onboarding";
declare const _default: import("@medusajs/types").ModuleExports<typeof PayPalModuleService> & {
    linkable: {
        readonly paypalConnection: {
            id: {
                serviceName: "paypal_onboarding";
                field: "paypalConnection";
                linkable: "paypal_connection_id";
                primaryKey: "id";
            };
            toJSON: () => {
                serviceName: "paypal_onboarding";
                field: "paypalConnection";
                linkable: "paypal_connection_id";
                primaryKey: "id";
            };
        };
        readonly paypalMetric: {
            id: {
                serviceName: "paypal_onboarding";
                field: "paypalMetric";
                linkable: "paypal_metric_id";
                primaryKey: "id";
            };
            toJSON: () => {
                serviceName: "paypal_onboarding";
                field: "paypalMetric";
                linkable: "paypal_metric_id";
                primaryKey: "id";
            };
        };
        readonly paypalSettings: {
            id: {
                serviceName: "paypal_onboarding";
                field: "paypalSettings";
                linkable: "paypal_settings_id";
                primaryKey: "id";
            };
            toJSON: () => {
                serviceName: "paypal_onboarding";
                field: "paypalSettings";
                linkable: "paypal_settings_id";
                primaryKey: "id";
            };
        };
        readonly paypalWebhookEvent: {
            id: {
                serviceName: "paypal_onboarding";
                field: "paypalWebhookEvent";
                linkable: "paypal_webhook_event_id";
                primaryKey: "id";
            };
            toJSON: () => {
                serviceName: "paypal_onboarding";
                field: "paypalWebhookEvent";
                linkable: "paypal_webhook_event_id";
                primaryKey: "id";
            };
        };
    };
};
export default _default;
//# sourceMappingURL=index.d.ts.map