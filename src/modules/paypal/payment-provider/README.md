# PayPal Payment Provider (Checkout)

This folder adds a **Payment Module Provider** so PayPal can appear in checkout.

Register it in `medusa-config.ts` under the Payment module:

```ts
{
  resolve: "@medusajs/medusa/payment",
  options: {
    providers: [
      {
        resolve: "./src/modules/paypal/payment-provider",
        id: "paypal",
        options: {},
      },
    ],
  },
}
```

Then enable PayPal in Admin -> Regions -> Payment Providers (use `paypal`).
