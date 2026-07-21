import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
export default function paypalOrderInvoiceHandler({ event, container, }: SubscriberArgs<{
    id: string;
}>): Promise<void>;
export declare const config: SubscriberConfig;
//# sourceMappingURL=paypal-order-invoice.d.ts.map