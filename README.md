# Generic Crypto Marketplace

A clean, self-hosted e-commerce starter with an empty catalog, product management, a browser cart, guest checkout, and cryptocurrency payment invoices.

## Included

- Blank catalog managed from `/admin.html`
- Responsive storefront and cart
- Guest shipping checkout
- BTC, ETH, USDC, and USDT payment selection
- NOWPayments invoice creation and signed IPN updates
- Local demo invoices when gateway credentials are absent
- SQLite storage and session-based admin access
- No external frontend framework or build step

## Start locally

```bash
cp .env.example .env
# Set SESSION_SECRET and ADMIN_PASSWORD in .env
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). The admin dashboard is at [http://localhost:3000/admin.html](http://localhost:3000/admin.html).

The first boot creates a blank `store.db` and seeds only the admin account from environment variables. Add products from the dashboard.

## Enable live crypto payments

Set these values in `.env`:

```dotenv
NOWPAYMENTS_API_KEY=your-api-key
NOWPAYMENTS_IPN_SECRET=your-ipn-secret
PUBLIC_BASE_URL=https://shop.example.com
```

Configure the gateway callback URL as:

```text
https://shop.example.com/api/payments/ipn
```

## Test

```bash
npm test
```

## Deploy

Run it behind an HTTPS reverse proxy. Persist the project directory so `store.db` survives restarts. Keep `.env` private and never place it under `public/`.
