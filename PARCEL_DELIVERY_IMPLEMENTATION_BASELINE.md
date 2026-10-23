# Parcel delivery implementation baseline

Audit date: 2026-10-22. Working tree was clean (`git status --short`). Read root AGENTS.md. No nested AGENTS.md files were found. The requested code-review-graph tools are not exposed by this session (tool discovery returned none); source searches/read-only inspection were used as the documented fallback. No database, gateway, configured application server, migration, index operation or deployment was started during this audit.

## Current lifecycle and assignment

`backend/models/Order.js`, `Delivery.js`, `controllers/deliveryPartner.controller.js`, `deliveryAssignment.controller.js`, `routes/delivery.routes.js`: shopping delivery is tied to an actual order, seller pickup and payment readiness. Orders progress through seller acceptance/preparation/dispatch; rider acceptance creates a Delivery with orderId. Rider stages include accepted, arrived_at_store, picked_up, in_transit, arrived_at_customer and OTP-verified delivered. Reverse pickups use a Return reference. Neither is an appropriate standalone parcel identity.

`broadcastNewOrderToRiders` searches the existing baseLocation.point 2dsphere index, numeric current/base coordinate bounds, then (Quick only) wider zone/availability fallbacks. Approval, account activity, duty, radius and workload are checked. It retries with per-process setTimeout and marks needsManualAssignment after three attempts. Reusing that function would introduce order and seller assumptions. Parcel offers need durable deadlines, atomic stale-token rejection and a bounded restart-safe sweep. `orderSweeper.service.js` supplies an existing 30-second scheduler for independent sibling jobs.

`riderCapacity.service.js` counts forward Orders and reverse Deliveries; unset RIDER_MAX_CONCURRENT_DELIVERIES means unlimited development capacity. It currently knows nothing about parcels. Parcel reservations must avoid weakening that behavior. Conservative parcel reservation can temporarily reserve the shared duty switch, retaining its previous value and restoring it only at safe release points. Cross-product acceptance races must be tested and remain a release blocker if existing order claims cannot honor that reservation.

## Customer and portal integration

Actual frontend directory: **forntend**. `App.jsx` dispatches portals by pathname, CustomerSessionGate verifies customer sessions, UserContext/LandingPage handle storefront navigation. Home discovery alongside QuickActions/LegalDiscovery is suitable for a gated Send a Parcel entry. Dedicated /parcel-delivery paths can be mounted under the existing customer session gate without altering the shopping navigation state machine. User.addresses stores line1, line2, city, state, pincode, contact and lat/lng. LocationPicker and geocode.service supply location selection/reverse geocoding; manual address plus explicit map coordinates must remain possible without browser location permission.

Delivery routes are protected by protect/requireApprovedPartner and DeliveryContext restores current shopping trips. Add a separate /delivery/parcels view, without fabricating activeOrder. Admin SuperAdminDashboard has delivery and finance workspaces: add parcel navigation there, with existing manage_orders for operations and manage_finance for policy/reconciliation/refunds; superAdmin retains its existing bypass. Admin and customer session tokens use separate local storage keys.

## Fees, payments and finance

`deliveryCharge.service.js` is a cached shopping flat charge with shopping coupon/cart assumptions. `riderPay.service.js` freezes shopping earning rates. Neither supplies approved parcel prices or earnings. Parcel policy must be explicit, versioned and frozen, with integer paise calculations, approved service areas/categories/limits/terms and no seeded business values.

`maps.service.js` has **mock-only route directions**; real getRoute/getDistanceMatrix throw. `geocode.service.js` provides actual reverse geocoding, not authoritative road distance. No production quote can be offered until directions support is verified. Do not substitute customer distance or straight-line distance for road pricing. Existing mock routing is usable only in an authorized isolated test runtime.

`razorpay.service.js` supplies order creation, constant-time signatures, authoritative payment fetch, signed raw webhook parsing and refund APIs. `Payment` supports independent serviceApplicationId plus gatewayAttempts, captures and durable refundObligations; add a dedicated parcelDeliveryId, never orderId. Shared webhook dispatch must recognize parcels before product settlement. `paymentRecovery.service.js` provides exclusive refund claims, uncertain outcome recovery and provider history validation, but creation recovery currently binds only orders/legal services; it needs an explicit parcel association adapter.

`financeSafety.service.js` requires transactional Mongo replica sets and deliberately fails closed without them. `SellerLedgerEntry`/`sellerLedger.service.js` is the existing append-only multi-account ledger used for sellers, riders, COD and legal services. Extend it with parcel reference/accounts and include that reference in replay validation. Its amount is decimal rupees; parcel arithmetic stays in integer paise and converts only at this adapter. Existing rider_payable entries and partner counters are coupled by reconciliation/payout services. Parcel earnings should remain in a distinct held parcel payable account until a separately approved payout adapter exists, avoiding accidental release through shopping rider payouts.

`financialReconciliation.service.js`, `orderFinance.service.js`, `deliveryPayout.service.js` and financeWorkflow controller distinguish COD custody, verified remittances, held/eligible/reserved earnings and evidence-backed payout completion. Parcel fee cash must use a separate ledger account and evidence-backed admin reconciliation; driver collection is not a deposit. No merchandise amount, seller commission or Quick courier fee applies to a parcel. Refunds require original captured payment, cumulative limits, explicit approval and compensating entries. Cash refunds require separate evidence, not a fabricated Razorpay event.

## Reuse and additions

Reuse protect, approved delivery identity, role context, error/response conventions, rate limiting, bounded frontend requests, Razorpay signatures/status client, refund recovery, shared transaction helper, shared ledger posting, existing notifications and the scheduler. Existing socket rooms identify users/riders/orders; authorized parcel HTTP refresh is safer initially than joining order rooms or broadcasting precise locations. Notifications must contain references only.

Add dedicated ParcelPolicy, ParcelQuote and ParcelDelivery models with automatic index creation disabled; quote ownership/expiry and policy revision checks; explicit parcel payment and ledger adapters; durable offers, reservation and stale-version checks; customer/driver/admin DTOs and routes; OTP proof with bounded attempts; cancellation/exception review, online refund and cash evidence workflows. Do not modify order lifecycle/assignment rules. New schemas declare required isolated-test/release indexes but must not create them at import/startup.

## Tests and safe prerequisites

- Backend existing commands: `npm test -- --runInBand`; targeted verification: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config verification/jest.config.js --runInBand --runTestsByPath verification/legal-services.test.js verification/financial-workflow.test.js verification/payment-notifications.test.js` from backend.
- Frontend: `npm run build`; Node test suites under tests/ and verification/. Browser verification scripts use isolated fixtures.
- New DB tests must start their own MongoMemoryReplSet, clear inherited database URLs, never import index.js/config/db.js/bootstrap or dotenv, replace Razorpay/maps/notification network boundaries, use synthetic policies, and explicitly create indexes only on that temporary database. Existing dependencies include Jest, supertest and mongodb-memory-server; browser tooling availability must be verified.
- Full existing suites may have pre-existing failures; report exact commands and outcomes without weakening assertions.

## Policies and release blockers

Unapproved: actual service areas and geofences, parcel taxonomy/prohibitions, legal eligibility review, weight/dimension limits and surcharges, tax treatment, fare caps, rider earning allocation, cancellation/refund entitlement by stage, cash collection point, failed delivery/return terms, operational timeout/radius/capacity, finance and release sign-off. Implement supported policy combinations only (reject unsupported ones), with no production defaults or automatic return/redelivery charges.

All parcel capability flags default false. Production/deployment-production mutations and financial execution remain unconditionally blocked for this implementation. Real charges/refunds/payouts, production data changes, index operations and deployment are outside this task. Release review must include verified routing, cross-product capacity, isolated concurrent workflow tests, privacy/permission tests, finance approval and explicit activation approval.
