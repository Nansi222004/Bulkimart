# Bulkimart — Multi-Vendor E-Commerce, Quick Commerce & B2B Platform

> **Bulkimart is a Multi-Vendor E-Commerce and Quick Commerce Platform supporting B2C retail and B2B/wholesale selling, enabling independent merchants to reach both everyday consumers and commercial buyers with optional hyperlocal delivery capabilities.**

---

## 1. Project Overview & Core Business Pillars

Bulkimart is a comprehensive digital commerce platform uniting multi-vendor retail trade, wholesale bulk buying, and fast hyperlocal fulfillment within a single operational ecosystem.

### Core Business Pillars

1. **Multi-Vendor E-Commerce:**
   * Multiple independent sellers, brands, and distributors onboard, manage their digital storefronts, list catalogs across diverse categories (packaged goods, electronics, fashion, household essentials), and process customer orders.
   * Centralized catalog moderation, category hierarchies, and fair seller marketplace policies.

2. **B2C Retail:**
   * Individual shoppers can browse, discover, and purchase individual items at retail prices.
   * Full retail shopping journey: persistent search, category filtering, user reviews, shopping cart, discounts, wallet/coins, and doorstep parcel delivery.

3. **B2B & Wholesale:**
   * Commercial and business buyers can purchase in bulk quantities.
   * Sellers register as business entities (proprietorships, partnerships, companies) with verified tax IDs (GSTIN, PAN, Trade License).
   * Multi-variant pack sizing allows sellers to offer retail units alongside commercial bulk packages with dedicated stock and unit weights.
   * Bulk catalog management via structured Excel templates and batch image imports.
   * Supports wholesale pricing models, quantity-based purchasing, and minimum order quantities where implemented.

4. **Quick Commerce:**
   * Hyperlocal shopping experience connecting shoppers to nearby physical stores and inventory.
   * Geofenced store discovery using real-time spatial coordinates and dynamic service radius boundaries.
   * Same-Day and rapid delivery pipeline with seller-configurable cut-off times and order preparation processing windows.

5. **Seller Management:**
   * Self-service vendor onboarding with business verification, KYC compliance, and bank account linking.
   * Complete seller operational dashboard: catalog management, inventory tracking, order acceptance, packing workflows, earnings analytics, and performance monitoring.
   * Independent seller brand identity: merchants showcase their own business name, logo, banner, and product brand names.

6. **Delivery & Logistics Fleet:**
   * Autonomous hyperlocal dispatch broadcast engine matching orders with nearby delivery partners.
   * Rider navigation, real-time assignment protection, OTP-based secure delivery confirmation, and reverse logistics (return pickup workflows).

7. **Promotions & Payments:**
   * Marketplace marketing engine: homepage promotional banners, featured product campaigns, and sponsored search rankings.
   * Secure multi-mode checkout powered by payment gateway integration (PhonePe) alongside Bulkimart Wallet and Coin rewards.

---

## 2. Official Operational Panels

The Bulkimart ecosystem consists of **four verified operational panels** (confirmed from the primary application router in `forntend/src/App.jsx`):

| # | Panel | Verified Route | Target Audience | Primary Operational Scope |
|---|---|---|---|---|
| 1 | **Super Admin Panel** | `/admin` | Platform Administrators | Central marketplace oversight: vendor approvals, KYC compliance, product catalog moderation, delivery zones, radius rules, tariffs, payouts, and platform analytics. |
| 2 | **Seller Panel** | `/seller` | Retail & Wholesale Vendors | Merchant store setup, business verification (GSTIN/PAN/Aadhaar/Bank), product catalog management, bulk Excel listing uploads, order fulfillment, and ad campaigns. |
| 3 | **Delivery Partner Panel** | `/delivery` | Delivery Fleet Riders | Driver onboarding, online/offline availability toggle, incoming order pings, pickup/drop navigation, return pickups, and earnings. |
| 4 | **Customer Storefront** | `/` (root) | Retail Consumers & Business Buyers | Unified customer experience with dual storefront modes (*Shop All* nationwide e-commerce & *Quick* hyperlocal grocery), search, cart, PhonePe checkout, and order tracking. |

### Internal Developer Utilities
* **Mock Payment Gateway (`/mock-phonepe`):** Internal testing sandbox used to simulate payment gateway webhook callbacks during local development.

---

## 3. Capabilities Assessment: B2C, B2B/Wholesale & Quick Commerce

### A. Retail (B2C) Capabilities — **[Implemented & Active]**
* **Dual Storefront Experience:** One-tap toggle between nationwide parcel E-Commerce (`shop-all`) and Hyperlocal Quick Commerce (`quick`).
* **Customer Catalog Exploration:** Multi-level category trees, brand filters, responsive search with debounce, voice search modal, and user ratings/reviews.
* **Shopping Cart & Checkout:** Channel-segregated cart isolation (preventing shipping mix-ups between 30-minute grocery and multi-day packages), promotional coupons, delivery address book, and Bulkimart Wallet/Coins redemption.
* **Payments & Orders:** PhonePe payment gateway integration, live order status progression, and return/replacement requests.

### B. Wholesale (B2B) Capabilities — **[Implementation Status Breakdown]**
Bulkimart supports both individual retail consumers and business/wholesale buyers:

* **Implemented & Active:**
  * **Business Vendor Verification:** Captures formal business identity (`individual`, `proprietorship`, `partnership`, `company`), GSTIN, PAN, Trade License, FSSAI, and verified bank credentials.
  * **Bulk Inventory Ingestion:** Sellers can download Excel templates and upload hundreds of products and variants with ZIP media archives (`backend/utils/excelParser.js`).
  * **Multi-Variant Pack Sizing:** Listings support independent variant lines, allowing sellers to list consumer pack sizes alongside commercial bulk packs with distinct pricing, weights, and stock (`backend/models/Product.js`).
  * **Independent Seller & Product Branding:** Merchants showcase their own store name, business banner, and manufacturer brand names (e.g., brand-specific SKUs like Amul, Tata, Nike, or merchant's proprietary brand).
* **Partially Implemented:**
  * **Organization / Tiered Seller Accounts:** Schema and verification workflows exist for tiered unit and block merchant partnerships (`isNscSeller`, `nhcPlan`).
  * **Commercial Invoicing Metadata:** GST rates and tax identifiers are captured at product and vendor level.
  * *Retail Cart Limits:* Default ceiling of `MAX_QTY_PER_LINE = 20` exists in `backend/controllers/cart.controller.js` for retail consumer baskets; bulk quantity threshold overrides for verified B2B buyer accounts are not yet exposed in the buyer UI.
* **Planned Roadmap Features (Not Yet in Code):**
  * **Volume-Tiered Pricing:** Dynamic graduated price breaks (e.g., Tier 1: 1–10 units, Tier 2: 11–50 units, Tier 3: 50+ units).
  * **Minimum Order Quantity (MOQ) Controls:** Enforcing strict minimum order thresholds per wholesale product line.
  * **Dedicated B2B Buyer Accounts:** Business customer profiles capturing buyer GSTIN for Input Tax Credit (ITC) invoicing.
  * **Wholesale RFQ & Credit Terms:** Request-for-quote workflows and credit payment terms.

### C. Hyperlocal Quick Commerce — **[Implemented & Active]**
* **Location-Based Store Discovery:** Hyperlocal spatial indexing (`2dsphere` GeoJSON coordinates) matching shoppers to stores operating within dynamic radius boundaries (`RadiusSetting.js`).
* **Same-Day Delivery Engine:** Merchant-controlled Same-Day toggle, daily cut-off times, and preparation time limits (`backend/models/Seller.js`).
* **Fleet Dispatching:** Real-time broadcast pings to nearby riders, concurrency limits, and OTP-verified deliveries.

### D. Legacy / Inactive Subsystems — **[Retained for Schema Compatibility Only]**
* **Grocery Subscriptions:** Backend models (`Subscription.js`, `subscriptionSweeper.service.js`) and admin reporting tabs exist in code; however, customer grocery subscription creation is **inactive in the primary customer UI** (sub-pages are unrendered).
* **CDS Community Membership:** Third-party cooperative membership verification stub (`cds.service.js`) and discount fields in pricing calculations; inactive in official Bulkimart scope.
* **Platform Packaging / Private Label:** Materials catalog (`PackagingMaterial.js`, `PackagingOrder.js`) and platform brand requests (`brandRequestSchema`); inactive in official Bulkimart scope.
* **SHG Marketplace:** Legacy cooperative channel models (`SHGStore.js`, `SHGSubscription.js`); inactive in official Bulkimart scope.

---

## 4. Local Setup & Access Guide

### Prerequisites
* Node.js >= 20.0.0
* MongoDB Atlas or local MongoDB instance

### 1. Backend Server Setup
```bash
cd backend
npm install
npm run dev
```
* **Port:** `5050` (configured in `backend/.env`)
* **API Base:** `http://localhost:5050/api`

### 2. Frontend Web Application Setup
```bash
cd forntend
npm install
npm run dev
```
* **Port:** `4173` (configured in `forntend/vite.config.js`)
* **URL:** `http://localhost:4173`

### 3. Accessing the Panels
* **Super Admin Panel:** `http://localhost:4173/admin`
  * *Default Email:* `admin@admin.com`
  * *Default Password:* `Admin123` *(or reset using `npm run admin:password` in `backend`)*
* **Seller Panel:** `http://localhost:4173/seller`
  * *Authentication:* Mobile OTP (`OTP_MODE=mock` uses OTP **`1234`**)
* **Delivery Partner Panel:** `http://localhost:4173/delivery`
  * *Authentication:* Mobile OTP (**`1234`**)
* **Customer Storefront:** `http://localhost:4173/`

---

## 5. Architectural Boundaries & Legacy Code Retained

To guarantee zero database corruption and avoid breaking active queries, legacy code and predecessor database references remain in the underlying source files but are **decoupled from official product specifications**:

* **Legacy Predecessor References (SHG, CDS, Platform Packaging):**
  * Historical models and routes remain in the codebase (`SHGStore.js`, `cds.service.js`, `packaging.controller.js`) to preserve database query compatibility and prevent breaking historical data records.
  * These modules are not part of the active Bulkimart business model and are documented strictly as technical legacy dependencies.
