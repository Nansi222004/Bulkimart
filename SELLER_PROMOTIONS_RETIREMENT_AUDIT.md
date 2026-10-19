# Seller promotions retirement audit

Date: 19 October 2026

## Result

Seller-paid promotions are disabled throughout the local frontend and backend implementation. The audit found customer discovery, public APIs, banner synchronization, paid ranking, and background work that had survived the earlier seller/admin menu removal. These active paths have now been removed or disabled.

| Area | Verified behavior |
| --- | --- |
| Seller panel | No promotion, advertising, campaign invitation, or grow navigation. Old seller promotion paths show the existing unavailable page with dashboard recovery. |
| Admin panel | Promotion pages, package editor, vendor advertising links, and product sponsorship controls removed. Retired admin tab URLs return to `/admin`, including browser history navigation. |
| Customer search | No `/api/promotions` request, promoted-store section, or promoted-result badge. Featured products remain admin-curated. |
| Customer home | Promotion landing page and overlay state removed. Historical seller advertisement banners are excluded by both API and carousel. Ordinary banners and campaign discounts remain available. |
| Seller APIs | Old authoring, package purchase, submission, cancellation, and payment initiation routes remain unregistered (404). |
| Admin APIs | `/api/admin/promotions`, `/api/admin/promotion-packages`, and their descendants reject all methods with 410. Product sponsorship endpoint also returns 410. |
| Public APIs | `/api/promotions` and every descendant reject all methods with 410. |
| Banner APIs | Seller advertisements excluded from ordinary and `all=true` lists. Draft creation and attempts to republish historical advertisements are rejected. Old advertisement click requests cannot increment their counters. |
| Product discovery | Historical paid boosts and sponsorship flags no longer influence catalogue ordering, search relevance, or featured discovery. Sponsorship flags are omitted from public product responses. |
| Background work | Promotion sweeper startup/shutdown, synchronization service, and promotion banner seed script removed. |
| Notifications | No new seller-promotion event persistence or push/socket fanout. Historical promotion events are excluded from inbox/badge queries; seller retirement filters remain. |
| Account lifecycle | Historical active promotion status no longer blocks seller deactivation. Promotion history still protects records from destructive deletion. |

## Intentional compatibility code

References to this feature still exist for these limited reasons:

- Historical `SellerPromotion` and `PromotionPackage` models, payment references, banner targets, notification metadata, and old product ranking fields preserve existing records. No promotion authoring or visibility service uses them.
- Retirement guards recognize old URLs, banner types, and notification events so they remain inaccessible.
- Verified historical payment callbacks can reconcile an existing payment. Settlement marks the associated advertisement `DISABLED`; it does not publish banners, apply ranking boosts, extend an advertising window, or send notifications. Successful callbacks remain idempotent.
- Account lifecycle checks count historical records to prevent accidental loss of history.

Generic customer offers, coupons, admin-managed discount campaigns, ordinary banners, and manually featured products are separate features and remain available.

No database cleanup or live-data deletion was performed. This report verifies the workspace source and locally built artifacts; it does not assert that a deployed server has received these changes.

## Validation

- Frontend production build and backend package/build checks passed.
- 53 frontend tests passed across startup/navigation, image/text search, and seller notifications.
- 29 backend tests passed across promotion retirement, historical payment settlement, Razorpay webhook regression, product deletion, account lifecycle, and notification behavior.
- 15 browser checks passed: retired seller routes at 390px and 1280px, plus customer home/search/checkout/account flows at 390px.
- API regression tests exercise old GET/POST/PUT/PATCH/DELETE requests, ensure rejected operations preserve database snapshots, exclude existing active advertisements, and verify organic search ignores legacy paid boosts.

Project graph tools were not available in this session; the audit used direct source, route, import, and reference inspection instead. QA sources under the existing test directories are local-only under the repository's current `.gitignore` rules.
