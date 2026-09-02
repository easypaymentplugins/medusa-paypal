# PayPal for Medusa

**Accept PayPal and credit card payments in your Medusa v2 store — built by an official PayPal Partner.**

[![npm version](https://img.shields.io/npm/v/@easypayment/medusa-payment-paypal?color=blue&label=npm)](https://www.npmjs.com/package/@easypayment/medusa-payment-paypal)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Medusa v2](https://img.shields.io/badge/Medusa-v2-9b59b6)](https://medusajs.com)
[![PayPal PPCP](https://img.shields.io/badge/PayPal-PPCP-003087)](https://developer.paypal.com)

---

## ✨ What you get

| Feature | Details |
|---|---|
| 🔵 **PayPal Buttons** | One-click PayPal checkout for your customers |
| 💳 **Card Payments** | Secure credit & debit card fields, hosted by PayPal (PCI compliant) |
| 🛠 **Admin Dashboard** | Connect your PayPal account and manage everything from Medusa Admin |
| 🌍 **Test & Live modes** | Try everything safely in Sandbox before going live |
| 🔐 **3D Secure** | Extra card security, configurable in one click |
| 🔄 **Reliable by design** | Payments are verified with PayPal at every step — webhooks, retries, and safety nets are handled for you |

---

## ✅ Requirements

- Medusa **v2**
- Node.js **18+**
- PostgreSQL

---

## 🚀 Installation

In your Medusa backend folder, run:

```bash
npm install @easypayment/medusa-payment-paypal
```

---

## ⚙️ Setup — 5 steps

### 1. Add the plugin to `medusa-config.ts`

```ts
import { loadEnv, defineConfig } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

export default defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },

  plugins: [
    {
      resolve: "@easypayment/medusa-payment-paypal",
      options: {},
    },
  ],

  modules: [
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            // PayPal Buttons
            resolve: "@easypayment/medusa-payment-paypal/providers/paypal",
            id: "paypal",
            options: {},
            dependencies: ["paypal_onboarding"],
          },
          {
            // Card payments
            resolve: "@easypayment/medusa-payment-paypal/providers/paypal_card",
            id: "paypal_card",
            options: {},
            dependencies: ["paypal_onboarding"],
          },
        ],
      },
    },
  ],
})
```

### 2. Run database migrations

```bash
npx medusa db:migrate
```

### 3. Connect your PayPal account

1. Start your Medusa server
2. Open **Medusa Admin → Settings → PayPal**
3. Choose **Sandbox** (testing) or **Live** (real payments)
4. Click **Connect to PayPal** and follow the steps

That's it — your credentials are saved automatically. Webhooks are registered for you too.

> 💡 Prefer manual setup? Click **Insert credentials manually** and paste your Client ID and Secret from [developer.paypal.com](https://developer.paypal.com/dashboard/).

### 4. Turn PayPal on in your region

Go to **Medusa Admin → Settings → Regions → your region** and enable:

| Payment provider | What it is |
|---|---|
| `pp_paypal_paypal` | PayPal Buttons |
| `pp_paypal_card_paypal_card` | Card payments |

### 5. Add PayPal to your storefront

The checkout UI comes as a separate package — install it in your **storefront** project:

📦 **[@easypayment/medusa-paypal-ui](https://www.npmjs.com/package/@easypayment/medusa-paypal-ui)** — ready-made PayPal components for Next.js storefronts, with a step-by-step guide.

---

## 🎨 Customize (optional)

Everything is managed in **Medusa Admin → Settings → PayPal** — changes apply instantly, no restart needed:

- **PayPal Settings** — turn PayPal on/off, button color, shape, and label
- **Advanced Card Payments** — turn card payments on/off, 3D Secure mode
- **Additional Settings** — capture vs. authorize, brand name shown at PayPal, invoice prefix

---

## 🔐 Going live — two things we recommend

1. **`PAYPAL_ENCRYPTION_KEY`** — set this to any long random text in your server's environment. Your PayPal credentials are then stored encrypted in the database. Keep the key safe: if it's lost, just reconnect PayPal.
2. **`MEDUSA_BACKEND_URL`** — set this to your backend's public address (e.g. `https://api.mystore.com`) so PayPal can reach your store for payment notifications.

<details>
<summary><b>Advanced options</b> (for developers — everything works without these)</summary>

<br>

| Variable | Default | What it does |
|---|---|---|
| `STOREFRONT_URL` | *(unset)* | Storefront address used for PayPal return/cancel pages (can also be set in Admin) |
| `PAYPAL_ENCRYPTION_STRICT` | `false` | `true` = refuse to save credentials unencrypted |
| `PAYPAL_SELLER_NONCE` | *(auto)* | Set a fixed random string when running multiple server instances |
| `PAYPAL_ADMIN_ORIGIN` | first `ADMIN_CORS` entry | Restricts the onboarding popup to your admin URL |
| `PAYPAL_WEBHOOK_COMPLETE_CART` | `true` | Safety net that finishes an order when the payment succeeded but the buyer's browser closed. `false` disables it |
| `PAYPAL_RATE_LIMIT_MAX` / `PAYPAL_RATE_LIMIT_WINDOW_MS` | *(off)* / `60000` | Optional request limit for the public checkout routes |
| `PAYPAL_WEBHOOK_RATE_LIMIT_MAX` / `PAYPAL_WEBHOOK_RATE_LIMIT_WINDOW_MS` | *(off)* / `60000` | Optional request limit for the webhook endpoint (separate from the above) |
| `PAYPAL_WEBHOOK_REPLAY_WINDOW_MINUTES` | `60` | Rejects webhook deliveries older than this |
| `PAYPAL_WEBHOOK_STALE_PROCESSING_MS` | `300000` | When the retry job re-picks-up interrupted webhook events |
| `PAYPAL_WEBHOOK_ID_LIVE` / `PAYPAL_WEBHOOK_ID_SANDBOX` | *(auto)* | Manual webhook-id override (normally automatic) |
| `PAYPAL_HTTP_TIMEOUT_MS` | `30000` | Timeout for calls to PayPal |
| `PAYPAL_CURRENCY` | `EUR` | Fallback currency if none is configured |
| `PAYPAL_ALERT_WEBHOOK_URLS` | *(unset)* | Comma-separated URLs that receive operational alert notifications |

**Monitoring:** operational counters live in the `paypal_metric` table; every webhook is recorded in `paypal_webhook_event` with automatic retries; audit events are logged as JSON lines tagged `"log":"paypal_audit"` (secrets redacted).

</details>

---

## 📄 License

MIT © [Easy Payment](https://www.npmjs.com/package/@easypayment/medusa-payment-paypal)
