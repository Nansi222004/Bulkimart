# Wholesale-only product creation

## Model and API contract

`Product.sellingChannels` is an optional array restricted to `ecommerce`, `grocery`, and `wholesale`. A new Wholesale-only product explicitly stores `['wholesale']`. Its existing `type` is still the category/fulfilment taxonomy; the seller workflow uses the existing E-Commerce physical category tree. Category ancestry and leaf validation are reused. No separate product, variant, inventory, or pricing catalog was introduced.

Compatibility is handled on reads, without rewriting existing data: when `sellingChannels` is absent or null, the existing `type` and active `channels[]` cross-listings continue to control retail visibility, and enabled variant offers continue to control Wholesale availability. Explicit lists restrict those existing permissions. Existing records, retail prices, stock, and category assignments are unchanged; no database migration or production update was executed. Deploy all channel-aware backend readers together before allowing Wholesale-only creation; older backend versions do not understand the restriction.

The existing multipart `POST /api/products` accepts `sellingChannels` in addition to its established fields. Wholesale-only creation requires an active, approved seller with approved Wholesale access, a valid active physical category, stock and validated terms for at least one enabled variant, and photos. Terms are stored in `variants[].wholesalePricing` using the established schema. The complete product and all variant terms are inserted in one transaction after validation and image upload. Transactional seller/user/category checks fence approval/account/category changes. There is no create-then-configure PATCH, so invalid configuration cannot leave a half-configured product. Failed creations attempt cleanup of uploaded assets, constrained to this seller's upload folder; remote cleanup failure is logged for retry.

The required legacy retail `price`/`mrp` compatibility fields are stored as zero for Wholesale-only products. These are not prices offered to customers: all retail access is denied, no retail price fields are collected, and Wholesale quotes use only the variant tier schedule. Wholesale comparison quotes return null for the unavailable retail price. Stock remains the existing shared variant stock and aggregate projection.

`PUT /api/products/:id` supports reopening and editing a Wholesale-only product, preserving its visibility, photos, stable variant IDs, SKU, attributes, stock, and terms. Server ownership, approval/active checks, version checks, and validation remain enforced. Ordinary edits and cross-listing actions cannot silently enable retail on a Wholesale-only product. Converting one to a retail listing is intentionally not exposed by this workflow; that would also require real retail prices and retail publication validation.

The existing authenticated `PATCH /api/products/:id/wholesale-pricing` still handles offers on existing products. Enabling an offer on a product with an explicit retail-only channel list adds Wholesale to that same list inside the existing transaction. Legacy products remain backward compatible. Disabling only changes the variant offer, retaining the product, retail prices, channel list and inventory.

Physical publication follows the actual current policy: approved sellers' physical products publish immediately, with admin takedown/rejection still respected. This change does not add or bypass a moderation queue. Digital products cannot use Wholesale-only creation or receive enabled offers.

## UI behavior

The three Seller Products tabs retain the common shell. Wholesale has a primary **Add Product** action (accessible name **Add Wholesale Product**) and secondary **Add Wholesale Offer to Existing Product**.

The primary action opens the established ProductModal with General Info, Category & Groups, Item Variants and Photos. It collects name, description, category ancestry, brand, images, variant identity/SKU/attributes, unit/weight/shared stock and per-variant Wholesale terms. It hides retail price/MRP, digital listing selection, retail delivery settings and unsupported status controls. Explicit channel eligibility and the existing publication policy are shown. Quantity/tier/price errors appear inline and in the editor's validation navigation; API failures retain the draft for retry. Duplicate submissions are locked, and responses belonging to an older draft cannot clear or close a newer editor.

The secondary action retains the existing physical product/variant selector and terms-only editor. Wholesale-only rows stay in the seller Wholesale list, including after offers are disabled, and provide both Edit product and Edit offer. They do not appear in either retail seller tab.

The shared mobile editor uses compact wrapping tabs, scrollable content and reachable save/close controls. No retail create/edit/upload workflow was replaced.

## Channel isolation

Explicit channel checks are applied to retail catalogs, text search, featured/grocery feeds, image search, direct product/details/reviews/FAQs/delivery endpoints, wishlist, public campaign/product promotion/banner targets, retail cart reconciliation/add/update, coupon context, and both single and grouped retail checkout validation. The public serializer also refuses a Wholesale-only document as defense in depth. Authorized Wholesale catalog, availability, quote and cart/checkout eligibility respect Wholesale permission while retaining the existing seller, category, variant and inventory checks. No payment, refund, cancellation or order snapshot calculation was changed. The order controller change is a visibility guard before existing pricing/payment behavior.

## Files changed for this follow-up

| Files | Purpose |
| --- | --- |
| `backend/models/Product.js`, `backend/utils/productChannels.js` | Optional explicit channel restrictions and legacy-compatible visibility helpers |
| `backend/controllers/product.controller.js` | Atomic Wholesale creation/editing, validation, visibility guards, reuse of existing upload/approval flow |
| `backend/services/productUploadCleanup.service.js` | Constrained cleanup after failed creation |
| `backend/services/sellerWholesaleOffers.service.js` | Extend explicit retail permissions when an approved seller enables Wholesale |
| `backend/services/wholesaleCatalog.service.js`, `backend/services/wholesaleEligibility.service.js` | Wholesale permission checks |
| `backend/controllers/cart.controller.js`, `backend/controllers/order.controller.js`, `backend/services/fulfilmentGroups.service.js`, `backend/controllers/coupon.controller.js` | Retail purchasing and quote isolation |
| `backend/services/imageSearch.service.js`, `backend/utils/publicProduct.js` | Search and serialization isolation |
| `backend/controllers/wishlist.controller.js`, `backend/controllers/banner.controller.js`, `backend/controllers/campaign.controller.js`, `backend/services/campaign.service.js`, `backend/controllers/sellerPromotion.controller.js` | Prevent retail recommendation/target leakage |
| `forntend/src/modules/Seller/components/ProductsTab.jsx`, `SellerWholesaleProducts.jsx`, `ProductModal.jsx` | Both toolbar flows, full Wholesale product editor and seller listing behavior |
| `forntend/src/modules/Seller/components/VariantWholesaleFields.jsx`, `VariantAttributesEditor.jsx` | Unsaved variant terms and multiple attribute editing |
| `forntend/src/modules/Seller/context/SellerContext.jsx` | Wholesale draft, multipart save/edit payloads, identity/version and stale-response handling |
| `forntend/src/modules/Seller/Seller.css` | Attribute styling and responsive layout |
| `forntend/scripts/seller-profile-wholesale.test.mjs` | New creation, payload, validation, duplicate and stale draft regressions |
| `backend/__tests__/api/wholesale-product-creation.http.test.js` | 32 real HTTP/database creation, isolation, eligibility, validation and rollback tests |
| `backend/__tests__/api/seller-payment.http.test.js` | Bring outdated persistence mocks into line with the transactional offer service; real transaction tests remain separate |
| `backend/scripts/verifySellerProfileWholesaleBrowser.mjs` | Actual browser create/upload/edit/reload at both widths using disposable data |
| `.gitignore`, `backend/.gitignore` | Include the new regression suite under existing restrictive test ignore rules |

Earlier Seller Profile/Products changes and unrelated working-tree changes were preserved. Graph tools requested by AGENTS.md were unavailable in this session; source inspection was used as the fallback.

## Tests and builds

From `backend`:

```powershell
npm test -- --runInBand __tests__/api/wholesale-product-creation.http.test.js __tests__/api/seller-profile-wholesale.http.test.js __tests__/api/wholesale.http.test.js __tests__/api/seller-product-creation.api.test.js __tests__/api/checkout-workflow.http.test.js __tests__/api/seller-first-checkout.http.test.js __tests__/api/seller-payment.http.test.js __tests__/api/razorpay-webhook.http.test.js __tests__/api/image-search.http.test.js __tests__/api/cart.api.test.js __tests__/services/inventory.service.test.js __tests__/services/onboarding-regressions.test.js __tests__/api/seller-pickup-sync.http.test.js __tests__/api/retired-notifications.http.test.js
npm run build
```

Result: **14 suites passed; 344 tests passed, 0 failed, 5 skipped (349 total)**. The five skips belong to the existing retired mocked PhonePe suite. After the last creation validation adjustment, the two creation suites were rerun: **46 passed, 0 failed/skipped**. Backend build passed.

From `forntend`:

```powershell
node --test --test-concurrency=1 scripts/seller-profile-wholesale.test.mjs scripts/seller-notifications.test.mjs scripts/wholesale-ui.test.mjs scripts/product-wholesale.test.mjs scripts/checkout-ui.test.mjs scripts/auth-role.test.mjs scripts/portal-startup.test.mjs scripts/socket-ui.test.mjs scripts/image-search-ui.test.mjs scripts/service-ui.test.mjs scripts/product-link.test.mjs
node --test scripts/seller-profile-wholesale.test.mjs
npm run build
```

Result: **177 passed, 0 failed/skipped** in the broader run. Focused seller suite: **23 passed, 0 failed/skipped**. Production build passed with the existing Vite large-chunk warning. Mocked frontend tests remain distinct from the browser and database tests.

From repository root:

```powershell
node backend/scripts/verifySellerProfileWholesaleBrowser.mjs
git diff --check
```

Final Chrome workflow passed at **390 × 900** and **1280 × 900**: all three modes; new Wholesale product with actual multipart photo upload and two tiers; save, reload, reopen, edit brand and save again; tier and stock persistence; exclusion from both retail seller tabs and public direct endpoints; existing-product offer save/reload/disable; unchanged retail/Quick Commerce prices and stock; denied unapproved/digital writes; approval/suspension refresh. The photo preview rendered and modal save/close reachability and viewport bounds were checked. Screenshots and `browser.json` are in ignored local `test-artifacts/seller-profile-wholesale/`, including `wholesale-create-{390,1280}.png`.

Chrome used the actual compiled frontend and normal HTTP backend on dynamically allocated local ports with an isolated MongoDB replica set. API responses were not mocked. Cloudinary's external uploader was replaced by a fixture stream; all other external providers used mock mode. The existing localhost:4173/5050 data was not used or changed. Real Cloudinary credentials/provider behavior and the live development database are remaining environment checks. No customer order or payment was created by the browser workflow; payment/checkout regressions used disposable fixtures and provider mocks.

`git diff --check` passed with line-ending conversion notices only. No dependency was added; no commit, push, deployment, production service restart, real approval-record mutation or live provider invocation occurred. An accidental root build also ran the existing `npm install` script and reported dependencies up to date; package manifests and lockfiles remain unchanged.
