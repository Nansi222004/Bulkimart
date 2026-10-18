# Public Wholesale implementation report

## Root cause and storefront comparison

Quick Commerce and ShopAll load products through public routes (`GET /api/products/grocery`, `/api/products`, `/featured`, `/search`, and `/:id`). Their frontend `useProducts` hook does not require a customer token. Category reads are public too.

Wholesale was different in three places:

1. `GET /api/products/wholesale/catalog` applied `protect` and `requireCustomerSession` before the controller. Guests received 401 and other portal sessions received 403.
2. `getWholesaleCatalog` also called `assertWholesaleBuyer`, even though the operation only reads products.
3. The frontend sent customer credentials for catalog/detail reads, skipped product price books and recommendations without a customer token, and replaced every catalog 401/403 with a customer sign-in message. The page cleared products after errors, producing the misleading zero-offer count.

The `/wholesale` storefront itself did not need a new route guard or a duplicate API. Existing retail serialization deliberately omits Wholesale terms; changing retail responses would unnecessarily affect Quick Commerce and ShopAll.

## Files and behavior changed

| File | Purpose |
| --- | --- |
| `backend/routes/product.routes.js` | Makes the existing catalog GET public under the existing public rate limiter. Keeps customer authentication on quotes and all existing protected operations. |
| `backend/controllers/product.controller.js` | Removes the catalog buyer assertion; validates allowed sorting alongside search, category, product ID and pagination. Returns existing API errors. |
| `backend/services/wholesaleCatalog.service.js` | Preserves eligibility and safe serialization. Returns category options across eligible results rather than one page; filters, sorts and paginates on the server. Sorts prices using attainable quantity tiers. |
| `forntend/src/modules/User/pages/WholesalePage.jsx` | Sends anonymous catalog reads, uses server category options/results, adds sorting, and distinguishes loading, error and empty states. Keeps retry, search, pagination and the existing heading. Removes the broken sign-in error action that referenced undefined `setActiveNav`. |
| `forntend/src/modules/User/pages/WholesalePage.css` | Styles the sorting control and gives mobile filter controls 16px text. Preserves the existing aqua/orange storefront. |
| `forntend/src/modules/User/context/UserContext.jsx` | Restores Wholesale product links through the public catalog without authorization headers; preserves backend error messages. |
| `forntend/src/modules/User/hooks/useProductWholesale.js` | Loads public variant terms for guests. Guest purchase attempts call the sign-in flow; authenticated purchases still need a successful server quote and the protected cart API. |
| `forntend/src/modules/User/hooks/useWholesaleRecommendations.js` | Allows anonymous recommendation reads. |
| `forntend/src/modules/User/pages/ProductDetailPage.jsx` | Prompts sign-in for purchasing and reuses the existing product/variant return intent and OTP restoration. |

## Server-side boundaries

The same aggregation still excludes deleted, inactive, unapproved, digital and non-Wholesale products. This model uses `status: approved` plus active/channel flags for published visibility. Sellers must have approved seller status, approved Wholesale channel membership, and an active associated account. Categories must remain available. Variants need enabled, valid quantity tiers, sufficient whole-number stock for MOQ, valid increments and valid currency amounts. Eligibility is evaluated before pagination.

Public responses use an explicit serializer: product display metadata, seller display name, available variant stock and terms, approved reviews, and answered questions. Seller account details, customer IDs, bank data, internal terms objects, unpublished reviews/questions and private files are excluded.

Quotes, cart mutation and transactional checkout continue to validate customer sessions, current inventory, MOQ, increments, pricing and seller eligibility. Admin, seller and delivery sessions do not gain customer purchase permission. Product creation, editing, stock, pricing and vendor/admin operations retain their middleware. No global authentication change or production data migration was made.

## Validation

Final results: tests use isolated MongoDB and mocked browser APIs, never production writes.

| Check | Command (run in the corresponding package) | Result |
| --- | --- | --- |
| Backend Wholesale, creation/privacy, pricing and existing transactional purchase regressions | `npm test -- --runInBand __tests__/api/wholesale.http.test.js __tests__/api/wholesale-product-creation.http.test.js __tests__/services/wholesalePricing.test.js` | 3 suites, 206 tests passed |
| Frontend catalog, product details, links, roles and unified cart | `node --test tests/wholesale-ui.test.mjs tests/product-wholesale.test.mjs tests/product-link.test.mjs tests/auth-role.test.mjs tests/unified-basket-ui.test.mjs` | 87 tests passed |
| Backend build/package checks | `npm run build` | Passed |
| Frontend production build | `npm run build` | Passed; existing large-chunk warning remains |
| Production-artifact browser checks | `node tests/mobile-layout.test.mjs --public-wholesale --width=390` (also 768 and 1280) | 18 route/scenario checks passed, zero browser errors |
| Whitespace check | `git diff --check` | Passed |

Browser scenarios at each viewport: guest catalog/category/sort, empty catalog, API failure with successful retry, guest product MOQ/tiers with purchase-to-sign-in intent, Quick Commerce page load, and ShopAll page load. Browser APIs were mocked; backend purchase correctness was checked separately against isolated real MongoDB models. Chrome required execution outside the sandbox after browser initialization timed out within it.

The repository intentionally ignores `backend/__tests__/` and `forntend/tests/`. Local QA updates are in `backend/__tests__/api/wholesale.http.test.js`, `backend/__tests__/api/wholesale-product-creation.http.test.js`, `forntend/tests/wholesale-ui.test.mjs`, `forntend/tests/product-wholesale.test.mjs`, and `forntend/tests/mobile-layout.test.mjs`. They cover public catalog access, guest product prices and sign-in intent, filtering/sorting/pagination, private-data exclusion, vendor/product visibility, customer-only writes, errors, retries and existing retail behavior. These local QA files remain subject to that existing ignore policy. The public rate limiter is reset between isolated API cases; production rate limits remain unchanged.

The requested knowledge-graph tools were unavailable in this session; analysis used targeted source searches instead.

## Deployment boundary

This change updates the local repository. Deploy the backend and frontend together to enable public browsing on the hosted site. No production catalog/data inspection or deployment was performed, so the count of eligible live products has not been verified. If the live catalog has no eligible products, the public page correctly shows an empty state.
