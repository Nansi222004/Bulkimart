# Seller promotions and campaigns retirement

Implemented and verified locally on 2026-10-16. No deployment, Atlas access, database migration, index operation, media deletion or financial operation was performed against application data. Tests use a disposable local MongoDB replica set and synthetic fixtures.

## Removed seller functionality

- Promotions and Campaigns / Deals navigation and dashboard tab dispatch.
- Campaign participation listing/detail and accept/reject screens.
- Advertisement draft creation/editing, module/product/shop/banner/package/preview wizard, submission/resubmission/cancellation and status screens.
- The legacy Grow screen, its fabricated campaign state and Extend action.
- Seller advertisement uploads and promotion-slot requests.
- Unmounted legacy advertisement payment initiation and browser-return handlers. The historical settlement handler used by the shared payment webhook remains.
- Campaign invitation socket/persisted notification production and seller advertisement notification production. Historical seller-program notifications are filtered from the seller inbox/unread count; foreground seller popups also ignore retired events. Stored notification records are not deleted.
- Dead seller-only answer/pricing/module helper functions and campaign styles.

Old `/seller/promotions`, `/seller/campaigns`, `/seller/grow`, `/seller/deals`, `/seller/advertisements` and nested paths resolve to the authenticated shell's Page unavailable view, with a Back to seller dashboard link. No promotion component is loaded. Unknown seller pages also receive this fallback instead of silently rendering the dashboard.

## Removed backend registrations

The following routes were removed from `backend/routes/seller.routes.js`. Authenticated seller requests now receive 404. Authentication and authorization remain in place for other seller endpoints.

| Method | Retired path |
| --- | --- |
| POST | `/api/sellers/promo-request` |
| GET | `/api/sellers/campaigns` |
| GET | `/api/sellers/campaigns/:id` |
| PATCH | `/api/sellers/campaigns/:id/accept` |
| PATCH | `/api/sellers/campaigns/:id/reject` |
| GET | `/api/sellers/promotions/packages` |
| GET, POST | `/api/sellers/promotions` |
| GET, PUT | `/api/sellers/promotions/:id` |
| POST | `/api/sellers/promotions/:id/submit` |
| POST | `/api/sellers/promotions/:id/resubmit` |
| POST | `/api/sellers/promotions/:id/cancel` |

`/api/sellers/promotions/:id/payment` was already unmounted and remains unavailable; its unused implementation is now removed. The unused `/api/promotions/payment/return/:merchantOrderId` implementation was also unmounted before this task. No new purchase or callback endpoint is introduced. Existing seller approval/session middleware is shared with operational features and remains unchanged; no exclusive seller campaign permission middleware was found.

## Shared and historical behavior retained

Admin campaign CRUD, advertisement review/approval/rejection/disable and promotion-package management remain behind the existing admin authorization. Public campaign and advertisement routes, banners, sponsored-product ranking and campaign price resolution remain. Existing accepted campaign participation continues to supply public deal prices.

The promotion expiry sweeper, banner/search-boost synchronization, shared payment webhook settlement, models, media references, financial records and account-deletion dependency checks remain because they support existing ads or historical integrity. Their names may still contain `SellerPromotion`; these are intentional retained dependencies, not seller entry points. No broad route registration or shared service was deleted.

No records, media, payments, refunds, wallet/ledger entries or indexes were deleted or migrated. HTTP regression tests snapshot seller, product, campaign, participation, advertisement, package, banner, payment and notification records around all retired requests and assert no changes.

**Separate business decision:** no live database was queried for active ads or pending billing. Operators must review ACTIVE, APPROVED, PAYMENT_PENDING, PENDING_REVIEW and CHANGES_REQUESTED advertisements and pending campaign participation. Seller purchasing, correction and participation are retired; admin bookkeeping remains available but no new acceptance/payment policy is invented. Existing pending rows are not automatically accepted, rejected, refunded or cancelled. Admin feedback is recorded without claiming a notification was sent to the seller.

## File inventory

| Path | Change |
| --- | --- |
| `backend/routes/seller.routes.js` | Remove seller campaign/promotion and legacy slot-request registrations/imports |
| `backend/controllers/seller.controller.js` | Remove `requestPromo` |
| `backend/controllers/campaign.controller.js` | Remove seller handlers and invitation producer; preserve admin/public operations |
| `backend/controllers/sellerPromotion.controller.js` | Remove seller authoring, uploads, billing initiation/return and seller notification code; preserve admin/public/historical settlement |
| `backend/controllers/notification.controller.js` | Seller-session inbox/count exclusion without modifying historical rows |
| `backend/services/campaign.service.js`, `backend/services/sellerPromotion.service.js` | Remove helpers referenced only by retired seller handlers |
| `forntend/src/modules/Seller/components/SellerCampaignsTab.jsx`, `SellerPromotionsTab.jsx`, `GrowTab.jsx` | Deleted seller-only components |
| `forntend/src/modules/Seller/components/LeftNav.jsx` | Remove seller navigation entries |
| `forntend/src/modules/Seller/pages/DashboardPage.jsx` | Remove component imports/tab cases; add unavailable fallback |
| `forntend/src/modules/Seller/context/SellerContext.jsx` | Remove Grow state and fake campaign submission handler |
| `forntend/src/modules/Seller/components/NotificationDrawer.jsx` | Filter retired history and remove promotion navigation action |
| `forntend/src/modules/Seller/utils/retiredFeatures.js` | Predicate shared by seller drawer and seller foreground popup |
| `forntend/src/components/NotificationPopup.jsx` | Ignore retired events in its seller mode; preserve customer behavior |
| `forntend/src/modules/Seller/Seller.css` | Remove retired campaign styles; retain shared discount styling |
| `backend/__tests__/api/seller-marketing-retirement.http.test.js` | Six real-router/model retirement, authorization, public behavior and historical settlement tests |
| `forntend/scripts/seller-notifications.test.mjs` | Four new actual-component regressions for navigation, old URLs, inbox and foreground events |
| `forntend/scripts/mobile-layout.test.mjs` | `--retired-seller` browser checks for direct entry/reload and mobile/desktop geometry |
| `.gitignore`, `backend/.gitignore` | Narrow exception retaining the new API test |

## Verification

| Command | Actual result |
| --- | --- |
| `cd backend; npm test -- --runInBand __tests__/api/seller-marketing-retirement.http.test.js` | 6 passed, 0 failed |
| `cd backend; npm test -- --runInBand` | 54 suites passed; 467 tests passed, 7 skipped, 0 failed; 474 total |
| `cd forntend; node --test --test-concurrency=1 scripts/auth-role.test.mjs scripts/seller-notifications.test.mjs scripts/checkout-ui.test.mjs scripts/socket-ui.test.mjs scripts/service-ui.test.mjs scripts/image-search-ui.test.mjs scripts/portal-startup.test.mjs` | 120 passed, 0 failed, 0 skipped |
| `cd backend; npm run build` | Passed |
| `cd forntend; npm run build` | Passed; existing large-chunk warning, main JavaScript approximately 1.69 MB minified |
| `cd forntend; node scripts/mobile-layout.test.mjs --retired-seller` | 6 Chrome page/viewport checks passed at 390px and 1280px; each direct route also reloaded; no application errors |
| `git diff --check` | Passed; Windows line-ending conversion warnings only |

The backend suites retain authentication, seller ownership, order lifecycle, delivery, payment, checkout, service and e-book tests. Frontend regressions retain notifications, session isolation, checkout and dedicated order details. No lint script is configured. Browser API responses use controlled local fixtures; real backend authorization/data preservation are separately exercised by the API suite. No production, real-device or external gateway/push verification was performed.

The first new backend test run exposed fixture mistakes (an unsupported admin token role and an incorrect assumption about the banner response envelope); those were corrected to follow the existing contracts. Sandboxed Chrome timed out at renderer initialization; the successful run used local fixture APIs outside that sandbox. An initial reload assertion ran before `document.body` existed and was corrected. Final relevant checks pass.

Initial Git status was clean. An unrelated concurrent whitespace edit appeared in `PORTAL_STARTUP_AND_PRODUCT_DETAILS.md` and was preserved. No reset, cleanup, commit or deployment was performed. Deploy backend and frontend together through the approved process to retire API and UI access consistently. No environment variable or database migration is required.
