# PayPal for Medusa

**Accept PayPal and advanced credit card payments in your Medusa v2 store — built by an official PayPal Partner.**

[![npm version](https://img.shields.io/npm/v/@easypayment/medusa-payment-paypal?color=blue&label=npm)](https://www.npmjs.com/package/@easypayment/medusa-payment-paypal)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Medusa v2](https://img.shields.io/badge/Medusa-v2-9b59b6)](https://medusajs.com)
[![PayPal PPCP](https://img.shields.io/badge/PayPal-PPCP-003087)](https://developer.paypal.com)

---

## 📋 Table of Contents

- [📦 What's included](#-whats-included)
- [✅ Requirements](#-requirements)
- [🚀 Installation](#-installation)
- [⚙️ Setup](#%EF%B8%8F-setup)
  - [Step 1 — Configure medusa-config.ts](#step-1--configure-medusa-configts)
  - [Step 2 — Run database migrations](#step-2--run-database-migrations)
  - [Step 3 — Connect your PayPal account](#step-3--connect-your-paypal-account)
  - [Step 4 — Enable providers in your region](#step-4--enable-providers-in-your-region)
  - [Step 5 — Configure settings](#step-5--configure-settings-optional)
  - [Step 6 — Add PayPal to your storefront](#step-6--add-paypal-to-your-storefront)
- [📄 License](#-license)

---

## 📦 What's included

| Feature | Details |
|---|---|
| 🔵 **PayPal Smart Buttons** | One-click wallet checkout via PayPal |
| 💳 **Advanced Card Fields** | Hosted, PCI-compliant advanced credit card inputs |
| 🛠 **Admin Dashboard** | Connect, configure, and switch environments from Medusa Admin |
| 🌍 **Sandbox & Live** | Toggle between test and production without restarting |
| ⚡ **Webhooks** | Automatically registered and verified with built-in retry support |
| 🔐 **3D Secure** | Configurable SCA/3DS per transaction |

---

## ✅ Requirements

- Medusa **v2**
- Node.js **18+**
- PostgreSQL

---

## 🚀 Installation

**In your Medusa backend directory**, run:

```bash
npm install @easypayment/medusa-payment-paypal
```

---

## ⚙️ Setup

### Step 1 — Configure `medusa-config.ts`

Add the plugin and both payment providers to your existing `medusa-config.ts`:

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
            // PayPal Smart Buttons (wallet checkout)
            resolve: "@easypayment/medusa-payment-paypal/providers/paypal",
            id: "paypal",
            options: {},
            dependencies: ["paypal_onboarding"],
          },
          {
            // Advanced Card Fields (hosted card inputs)
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

---

### Step 2 — Run database migrations

```bash
npx medusa db:migrate
```

---

### Step 3 — Connect your PayPal account

1. Start your Medusa server
2. Open **Medusa Admin → Settings → PayPal → PayPal Connection**
3. Choose **Sandbox** (testing) or **Live** (production)
4. Click **Connect to PayPal** and complete the onboarding flow

Credentials are saved automatically. Prefer manual setup? Click **Insert credentials manually** and paste your Client ID and Secret from [developer.paypal.com](https://developer.paypal.com/dashboard/).

> **🔐 Encrypt secrets at rest (recommended for production).** Set `PAYPAL_ENCRYPTION_KEY` to any strong random string. The seller client secret and PayPal app access token are then stored AES‑256‑GCM‑encrypted in the database; without it they are stored in plaintext (the previous default). Encryption is transparent — existing plaintext credentials keep working and are upgraded to ciphertext the next time they are saved/refreshed.
>
> Keep this key safe and backed up: **if it is lost, stored credentials cannot be decrypted** and you must reconnect PayPal. Rotating the key requires re‑saving credentials.

---

### Step 4 — Enable providers in your region

1. Go to **Medusa Admin → Settings → Regions → [your region]**
2. Under **Payment Providers**, enable:

| Provider ID | Description |
|---|---|
| `pp_paypal_paypal` | PayPal Smart Buttons (wallet) |
| `pp_paypal_card_paypal_card` | Advanced Card Fields (card) |

---

### Step 5 — Configure settings *(optional)*

All settings live in **Medusa Admin → Settings → PayPal** and apply immediately — no server restart needed.

| Tab | What you can configure |
|---|---|
| **PayPal Settings** | Enable/disable, button color, shape, label |
| **Advanced Card Payments** | Enable/disable, 3D Secure mode |
| **Additional Settings** | Payment action (capture / authorize), brand name, invoice prefix |

---

### Step 6 — Add PayPal to your storefront

The checkout UI is shipped as a separate package — **install it inside your storefront project**, not in this backend.

📦 **[@easypayment/medusa-paypal-ui](https://www.npmjs.com/package/@easypayment/medusa-paypal-ui)** — React components, hooks, and a drop-in payment step adapter for Next.js App Router storefronts.

See the [storefront integration & testing guide →](https://www.npmjs.com/package/@easypayment/medusa-paypal-ui)

---

## 📊 Observability

- **Metrics** — operational counters (e.g. `create_order_success`, `capture_order_failed`, `webhook_success`, `webhook_dead_letter`) are persisted in the `paypal_metric` table.
- **Audit trail** — security/lifecycle events (credential changes, environment switches, webhook registration, capture/refund failures, alerts) are emitted as structured JSON log lines tagged `"log":"paypal_audit"`. In production, ship stdout to your log aggregator and filter on that tag. Sensitive fields (secrets, tokens) are redacted before logging.
- **Webhooks** — every received event is recorded in `paypal_webhook_event` with status (`processed` / `failed` / `dead_letter` / `ignored`), attempt count, and last error; failures are retried by the `paypal-webhook-retry` job.

---

## 📄 License

MIT © [Easy Payment](https://www.npmjs.com/package/@easypayment/medusa-payment-paypal)