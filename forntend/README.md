# Bulkimart Frontend Web Application

The frontend client for the **Bulkimart Multi-Vendor E-Commerce, Quick Commerce & B2B Platform**, built with React, Vite, and Vanilla CSS design tokens.

---

## Official Operational Panels & Routes

Routing is handled via clean path-based routing in `src/App.jsx`:

* **Customer Storefront (`/`):** Unified responsive shopping interface with dual storefront modes (*Shop All* nationwide e-commerce & *Quick* hyperlocal grocery), category browsers, cart, checkout, order tracking, and wallet.
* **Super Admin Panel (`/admin`):** Operations workspace for managing vendors, KYC, orders, payouts, delivery zones, categories, and promotions.
* **Seller Panel (`/seller`):** Vendor portal for store profile registration, product catalog, bulk Excel upload, order management, and advertising.
* **Delivery Partner Panel (`/delivery`):** Mobile-first driver interface for order pings, active delivery navigation, return pickups, and earnings.
* **Mock Payment Gateway (`/mock-phonepe`):** Development utility for simulating PhonePe payments in test environments.

---

## Development

```bash
npm install
npm run dev
```

* Dev Server runs on: `http://localhost:4173`
* Production build: `npm run build`
* Build output directory: `dist/` (can be served directly by the backend Express server)
