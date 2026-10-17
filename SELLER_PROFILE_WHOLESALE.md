# Seller profile and wholesale listing integration

## Inspection findings (before implementation)

1. Seller profile: SellerProvider restores `/api/sellers/me` using the seller token and `portalRequest`. The response is `{ success, seller, limits }`, with populated `seller.userId` containing the authoritative account name/phone/email. ProfileTab instead mixes this record with localStorage and hardcoded identity, contact, address, verification, tier, region and hours. Edit Profile is a toast. `PUT /api/sellers/profile` permits store name, description, address, store phone/email, city/state/pincode, coordinates, branding and Same-Day settings; account phone, business identity, seller status and approval are not editable through that endpoint. Failed profile reads currently become an indistinguishable empty profile.

2. Retail listing: ProductsTab uses SellerProvider's activeMode (`ecommerce` or `quick`), translated to `ecommerce`/`grocery`. `/api/products/seller/mine?type=...&roleContext=seller` includes primary and cross-listed products owned by the authenticated seller. Both modes reuse ProductModal's General Info, Category & Groups, Item Variants and Photos, POST/PUT product APIs, channel-specific category selection, bulk upload and atomic stock adjustment. Physical creation is approved/active in the current contract; digital products start pending and require their existing PDF lifecycle. Wholesale must not become a product `type` or a third inventory channel.

3. Wholesale storage: optional hidden `Product.variants[].wholesalePricing` contains enabled, minimumQuantity, quantityIncrement, and priceTiers of minimumQuantity/unitPrice. Terms use whole quantities up to 100,000; first tier starts at MOQ; later thresholds must align with increments, be unique, and have non-increasing positive unit prices with at most two decimals. Authoritative quote arithmetic uses integer paise. Seller-owned product responses explicitly select terms; public serializers exclude them. Existing retail saves strip client wholesale terms and preserve existing books by stable variant ID. The dedicated PATCH `/api/products/:id/wholesale-pricing` uses array filters and a product-version increment, without overwriting stock or retail prices.

4. Eligibility: seller status, wholesaleChannel.status and the wholesale salesChannels capability must all be approved. Requests reuse POST `/api/sellers/wholesale-request`; admin decisions use optimistic seller versions and the existing lifecycle service. Buyer catalog/quotes also require physical ecommerce/grocery products, approved/active products/categories, valid variant association and sufficient stock. No separate offer-approval model exists. Seller profile status and wholesale approval are distinct.

5. Conflicts: the seller wholesale write checks digital type/ownership/approval but omits active product/category/stock checks; its pre-read and write need concurrency protection for eligibility. The frontend wholesale save blindly submits every variant and gives only toast errors; list fetches have no error state or generation guard. Wholesale must list both retail product types without changing activeChannel for stock/orders/bulk upload. Notification endpoints already exist, but optimistic read/delete operations swallow failures and the seller drawer lacks loading/error UI. No screenshots were attached to this request; the existing seller layout is the visual reference.

## Scope

Local changes only. Approval and persistence verification must use disposable MongoDB fixtures, never real seller decisions or customer orders. Existing payment, checkout, inventory transaction and public serialization behavior remains in place.

## Implemented behavior

- Profile reads use only the current server seller/account record. Missing values remain explicitly unavailable. The store editor permits name, description, alternate phone, store email and address fields; seller/account identity and approval remain read-only. Saving validates fields, locks repeated submissions, checks session identity, uses optimistic versions and refreshes the context after server success. The existing location pin and pickup-registration correction flow are retained. Fabricated verification/tier/hours and the redundant profile logout control were removed; existing portal logout remains.
- E-Commerce and Quick Commerce retain their product types and bulk/stock flows. Wholesale is a Products view, never a new product type. It reads the existing owned-products endpoint without the retail type filter, excludes digital products, and shows variant identity/SKU, enabled state, MOQ, increment, tiers, stock and eligibility. Search, category/offer filters and local pagination are provided. Unapproved sellers see a deliberate access state; API failure is distinct from an empty catalog.
- ProductModal retains its four sections and adds validated variant terms. In Wholesale mode it opens Item Variants, keeps retail details read-only, and sends only changed existing variant price books to the existing PATCH endpoint. New physical listings/variants are saved through their original retail channel first and then configured by stable variant ID. Offer disabling never disables retail. The editor warns before discarding unsaved changes, blocks duplicate saves and ignores stale responses. New-product drafts no longer inherit the last edited product's values.
- Profile PUT now validates supported fields and rejects server-controlled changes. Offer PATCH now enforces product/category/stock eligibility in a replica-set transaction, fences seller/account/category eligibility changes and returns the updated product version. Existing product create/update paths also reject explicit enabled terms with inadequate stock or an unavailable product/category. No schema, database migration, dependency, public serializer, approval system, order or payment implementation changed.
- Notifications retain existing endpoints. Read/delete success is applied only after the API succeeds; failures remain visible and retryable. Session changes invalidate prior rows/responses.

## Changed files

Backend: `controllers/seller.controller.js`, `controllers/product.controller.js`, new `services/sellerProfile.service.js`, new `services/sellerWholesaleOffers.service.js`, new `__tests__/api/seller-profile-wholesale.http.test.js`, new `scripts/verifySellerProfileWholesaleBrowser.mjs`, and the test-file allowlist in `backend/.gitignore` and root `.gitignore`.

Frontend: `src/modules/Seller/components/ProfileTab.jsx`, `ProductsTab.jsx`, `ProductModal.jsx`, `NotificationDrawer.jsx`; new `ProductSellingModes.jsx`, `SellerWholesaleProducts.jsx`, `VariantWholesaleFields.jsx`; `src/modules/Seller/context/SellerContext.jsx`, `pages/DashboardPage.jsx`, `Seller.css`; new `src/modules/Seller/utils/wholesaleOffer.js`; `src/utils/useNotifications.js`; new `scripts/seller-profile-wholesale.test.mjs` and the existing hook harness's explicit rerender helper. This document records inspection and verification.

## Verification

Baseline: 131 backend tests across existing wholesale and seller-product suites; 47 frontend tests across wholesale UI, seller notifications and portal startup. All passed before implementation.

Final backend command (193 passed, 0 failed, 0 skipped):

```powershell
cd backend
npm test -- --runInBand __tests__/api/seller-profile-wholesale.http.test.js __tests__/api/wholesale.http.test.js __tests__/api/seller-product-creation.api.test.js __tests__/api/seller-pickup-sync.http.test.js __tests__/api/retired-notifications.http.test.js __tests__/services/onboarding-regressions.test.js
```

Final frontend command (167 passed, 0 failed, 0 skipped):

```powershell
cd forntend
node --test --test-concurrency=1 scripts/seller-profile-wholesale.test.mjs scripts/seller-notifications.test.mjs scripts/wholesale-ui.test.mjs scripts/product-wholesale.test.mjs scripts/checkout-ui.test.mjs scripts/auth-role.test.mjs scripts/portal-startup.test.mjs scripts/socket-ui.test.mjs scripts/image-search-ui.test.mjs scripts/service-ui.test.mjs scripts/product-link.test.mjs
```

Both frontend and backend `npm run build` passed. Frontend retains Vite's existing large-chunk warning. `git diff --check` passed.

`node backend/scripts/verifySellerProfileWholesaleBrowser.mjs` passed using actual headless Chrome, a disposable frontend build, the normal backend process and an isolated MongoDB replica set. API responses were real; the browser transport proxy forwarded requests to the fixture backend. External provider integrations used mock configuration. Checks included profile data, save/reload, pending-to-approved/suspended transitions through authorized admin APIs, three listing views, an existing variant's two quantity-price tiers saved/reloaded, retail and Quick Commerce price/stock isolation, direct denial for an unapproved seller and a digital product, notification read/clear/close, and profile/editor geometry at 390px and 1280px. Evidence is in `test-artifacts/seller-profile-wholesale/browser.json` and adjacent screenshots. No real seller record or customer order was created or changed by browser verification.

## Limits

No screenshots accompanied the request, so the existing portal supplied the visual reference. Account name/phone, legal business identity and verification are intentionally not editable through the store-profile endpoint. Partner tiers have no model field and display unavailable. Wholesale bulk import/export remains unsupported; existing retail bulk upload is retained. Seller-owned products are still loaded by the existing unpaginated API and paginated locally in the Wholesale view; large-catalog performance was not benchmarked. Offer activation requires stock meeting MOQ; higher tiers may exceed current stock and become reachable after restocking, consistent with existing catalog/quote rules. Replica-set transactions were already an application requirement and now also protect seller offer saves. Live push, cloud uploads, payment and carrier services were not exercised. No commit, push, deployment, production restart or production database operation was performed.
