# Customer Legal Services and Parcel UI fix

Date: 2026-10-23, Asia/Calcutta. Scope: customer discovery and parcel read-state reliability only. Reviewed the current worktree, root AGENTS.md and CUSTOMER_SERVICES_PARCEL_UI_AUDIT.md before editing. Required code graph tools were not exposed by this session; tool discovery returned no matches, so source inspection was used. Existing unrelated worktree changes were preserved.

## Root causes addressed

1. Home rendered a single ServicesDiscovery banner leading to a combined hub. Customers lacked independent home entries for the existing legal and standalone parcel workflows.
2. Tracking dispatch depended on `track && booking`; a failed valid tracking read left booking null and fell through to booking markup, dereferencing null policy. Invalid tracking paths likewise fell through to booking.
3. History cleared rows before reads and displayed its zero-row empty state even after failures. A failed refresh discarded the previously successful list.

## Changed files

- `forntend/src/modules/User/pages/LandingPage.jsx`: replaces the combined home banner with HomeServiceEntries after existing QuickActions. Existing home condition remains: Shop All home rendering or Quick grocery--home. Other Quick category pages and existing Categories/Offers/Wholesale/Orders/Cart/checkout behavior are preserved.
- `forntend/src/components/services/CustomerServices.jsx`: adds HomeServiceEntries and LegalServiceCard; reuses existing ParcelServiceCard. Each card owns its capability/error/retry state. Existing `/services` hub remains for backward-compatible direct links, but home no longer directs customers through it.
- `forntend/src/components/services/customerServices.css`: compact aqua/orange cards, independent focusable controls, wrapping; two columns above 480px, single column on small mobile screens.
- `forntend/src/components/parcels/ParcelDelivery.jsx`: explicit route validation and loading/read-error/unavailable/success rendering; private tracking/history reads independent of booking-policy retrieval; refresh snapshot retention; stale-response cancellation and route-key checks; existing successful tracking actions and timeline preserved.
- `forntend/verification/parcel-read-ui.test.mjs`: twenty focused tests using existing isolated hook harness/Vite infrastructure and actual components. Existing eight customer-services tests reused unchanged.
- This report, `CUSTOMER_SERVICES_PARCEL_UI_FIX_REPORT.md`.

No backend, environment, authentication/session-guard, customer route-registration, quick-action implementation, driver assignment or financial workflow files were changed by this task.

## Separate entry points

Legal Services: own title/icon/description on home; public capability check controls Browse Legal Services → `/legal-services`. Disabled catalogue gives explicit unavailable text; failed capability request gives Retry legal availability; no submission promise or active browse link on failure/disablement. Existing backend published/customer audience filtering and existing catalogue/request workflow are reused. Private history remains available via Account and existing legal pages, independently of intake availability.

Send a Parcel: own package icon/title/pickup-and-delivery description on home, reusing ParcelServiceCard. Book a Parcel → `/parcel-delivery/book` only when existing capability and effective-policy conditions pass; disabled booking displays Coming soon/unavailable and disabled booking button. API errors expose Retry parcel availability. My parcel deliveries → `/parcel-delivery/history` remains available. History rows navigate to `/parcel-delivery/track/:id`. Existing customer verification/sign-in and owner checks remain.

Legal capability failure/disablement cannot unmount the parcel card; parcel state cannot unmount Legal Services. No legal/GST backend or catalogue records are needed for parcel discovery. Normal anchor navigation and the existing App/UserContext pathname handling are reused; parcel handles both popstate and app:locationchange and cleans listeners up. Existing customer bottom navigation remains on home/legal/hub; standalone parcel retains its own navigation/home link. No Subscription entry was added.

## Tracking and history state handling

- Recognize only parcel root/book, history, or a valid 24-hex tracking path (optional trailing slash). Unknown descendants/malformed/missing tracking IDs show Invalid parcel link and history navigation, never a booking form.
- Initial reads show route-specific loading. Tracking fetches only its private record; it no longer depends on an available catalogue/policy to display an existing booking.
- Tracking null success shows tracking unavailable. Malformed tracking payloads and HTTP/network failures show tracking-specific read error with Retry. No booking fallback executes on any tracking read failure, including failed refresh.
- Valid tracking keeps the existing status/details/timeline and existing server-guarded payment/cancellation actions. Missing required tracking structures are rejected as invalid response before rendering.
- History success with zero records alone shows No parcel bookings yet. Successful rows preserve existing tracking navigation.
- History failure shows history-specific error and Retry, never the empty-history message. A failed same-route/page refresh shows the last successful non-empty list with an explicit outdated-status notice. Different route/page snapshots are not displayed as current results. While reads are pending, loading is shown instead of empty/error/success content.
- Read errors are separate from action errors. AbortController cleanup prevents late success/error/finally updates after route changes, retries or unmount. Route keys prevent previous-route data being rendered before the next effect loads the requested page.
- Missing/malformed policy data cannot enter booking markup. Backend remains authoritative for all operations.

## Verification

Commands below run in `forntend` unless labeled backend/root. Tests use mocked frontend reads or the existing isolated backend runner; no production sessions, database, gateways or directions were used.

| Command | Actual result |
| --- | --- |
| `node --test verification/customer-services-ui.test.mjs verification/parcel-read-ui.test.mjs tests/auth-role.test.mjs tests/portal-startup.test.mjs tests/service-ui.test.mjs tests/checkout-ui.test.mjs` | Successful rerun: 128 passed, 0 failed. Includes eight existing discovery checks, eighteen new checks at that point, and 102 existing navigation/auth/startup/service/checkout regressions. |
| `node --test verification/customer-services-ui.test.mjs verification/parcel-read-ui.test.mjs` | Final focused run after route-key render guard and two additional home/policy checks: 28 passed, 0 failed (8 existing + 20 new). These overlap the previous run; do not sum the totals. |
| Backend: `node verification/run-shopping-capacity-tests.mjs --config verification/jest.config.js --runInBand --runTestsByPath verification/parcel-delivery.test.js verification/parcel-routing.test.js` | 2 suites passed, 79 passed, 0 failed. Isolated backend safety/auth/routing regression checks; no backend source edits. |
| `npm run build` | Passed after final source change; existing >500 kB bundle warning. |
| `node tests/mobile-layout.test.mjs --full --paths=/,/legal-services,/parcel-delivery/history --widths=390,1280` | Failed before page inspection: Browser command timed out: Page.enable. Mobile/desktop browser geometry and screenshots remain unverified. |
| Root: `git diff --check` | Passed; informational LF/CRLF notices only. |

The first combined frontend run had 127 passed/1 failed: a newly added test helper searched only string children and missed alert text alongside a nested Retry button. The helper was corrected to inspect child text arrays; no application behavior/assertion was weakened. The same combined command then passed all 128 tests. An initial invocation from the repository root found no frontend test paths and ran no tests; it was rerun from the frontend directory. Vite emitted optimizer/websocket-port diagnostics while independent suites ran; completed test commands exited successfully.

Focused cases cover 401/403/404/503 tracking failures and retry, successful tracking without policy, failed refresh, missing/malformed payloads/IDs, navigation/unmount stale responses, history loading/empty/list/error/retry/retained-list states, authorization failures distinct from empty, independent home card composition/destinations, unchanged home/category/nav dispatch, and booking without policy.

Backend build not rerun because no backend files changed. Full frontend/backend suites were not run. Previously documented unrelated baseline failures in the parcel implementation report are neither newly reproduced nor claimed resolved here.

## Safeguards and remaining blockers

All legal and parcel flags remain unchanged. No production feature enabled, no seed/index/migration/database mutation, no payment/refund/transfer/payout, no deployment. Parcel production guards remain effective; catalogue and booking eligibility remain separate. No shopping orders, COD, ordinary rider earnings, seller settlement or assignment/admin fallback logic was edited.

Authoritative real directions remain unimplemented in the existing maps adapter; no mock or straight-line production quotation was introduced. Even enabled capability checks/effective policy do not prove live routing, gateway, database or rider readiness. Deployed flags/catalogue/indexes and full browser journey remain unverified. Separate operational authorization and verification are required before any live readiness claim.

## Visual layout implementation — 2026-10-23

This section records the subsequent Legal Services / Send a Parcel visual-layout task. The successful browser results below supersede the earlier browser-verification blocker above. Existing unrelated worktree changes were retained. Code-review-graph tools were searched for first but are not exposed in this session; source inspection was the fallback.

### Actual layout causes

- LegalServices used `margin: auto` inside the vertically arranged `.user-main-content` flex container. Its vertical auto margins consumed unused viewport space and moved the content away from the header. The new customer-page rule uses `margin: 0 auto` and prevents flex expansion/shrinkage of the content section.
- App dispatched parcel URLs before UserRoutes, so parcel pages bypassed the storefront's UnifiedHeader, scroll container, theme and BottomNav. The standalone `.parcel-workspace` added a different background, `min-height: 100%`, and 100px bottom padding. Its background ended at the workspace boundary while the root retained its own viewport/background, creating the visible seam/empty region.
- Legal errors still fell through into empty catalogue markup and always displayed pagination, even when no catalogue existed. Error and empty results now have distinct compact cards; pagination appears only when multiple pages exist.

### Files changed in this task

- `forntend/src/App.jsx`: removed the standalone parcel branch/import so customer parcel routes pass through the existing CustomerSessionGate and UserRoutes. Other portal dispatch is unchanged.
- `forntend/src/modules/User/context/UserContext.jsx`: recognizes `parcel-delivery` as a customer navigation destination, including deep links. Existing `services` registration was retained.
- `forntend/src/modules/User/pages/LandingPage.jsx`: mounts ParcelCustomerEntry beneath one UnifiedHeader in the existing customer shell, alongside LegalServices. Existing BottomNav and responsive desktop/mobile behavior are reused.
- `forntend/src/components/services/CustomerServiceHeading.jsx`: shared heading with decorative, accessible Scale/Package icons.
- `forntend/src/components/services/customerServicePages.css`: customer-only layout, matching heading/card/button sizing, aqua and orange accents, white bordered cards, normal wrapping, content-sized height, zero vertical auto margins and transparent page backgrounds. Mobile bottom-nav clearance includes the safe-area inset; desktop uses normal spacing when the storefront hides bottom navigation. Admin, Seller, Delivery, SHG and legal-provider workspace classes are not targeted.
- `forntend/src/components/services/LegalServices.jsx`: matching heading and polished loading/error/empty cards, preserved catalogue/form/request/payment/retry APIs and actions. API errors do not also display empty results. Empty search and empty request history have appropriate text.
- `forntend/src/components/parcels/ParcelDelivery.jsx`: consistent section/heading for guest and every authenticated read state; compact sign-in card with existing `/account` anchor. Verified-session branching, booking, quote, history, tracking, payment, cancellation, errors/retries and policy guards remain in place. Nested main landmarks and the redundant standalone Bulkimart home heading were removed in favor of the real storefront header.
- `forntend/verification/customer-services-ui.test.mjs`: checks the new empty-state heading and ensures API errors do not claim an empty catalogue.
- `forntend/verification/customer-service-pages-browser.mjs`: production-app verification across all requested mobile widths plus 768px and 1024px; API interception, session gate, shell, loading/available/empty/error/recovery, guest sign-in navigation, authenticated form, history-to-tracking navigation, overflow/spacing and bottom-nav reachability checks. Screenshots saved for 320px, 390px and 768px.
- `forntend/verification/parcel-delivery-browser.mjs`: corrected its stale error-recovery selector to use the existing Retry button (the read-error state does not offer Refresh status).
- This report was appended, preserving the previous implementation record.

### Verification results

All commands ran from `forntend`. Browser APIs and payments use isolated fixtures, not live accounts or gateways.

| Command | Result |
| --- | --- |
| `node --test verification/legal-services-ui.test.mjs verification/parcel-read-ui.test.mjs verification/customer-services-ui.test.mjs tests/auth-role.test.mjs tests/portal-startup.test.mjs tests/service-ui.test.mjs tests/checkout-ui.test.mjs` | 139 passed, 0 failed. |
| `node verification/customer-service-pages-browser.mjs` | 56 production-app state/viewport views passed across 320, 360, 375, 390, 430, 768 and 1024px. No runtime exceptions or horizontal overflow. One storefront header and bottom-nav component per page; desktop hides navigation as the rest of the storefront does. Guest action reaches `/account`; authenticated booking/history/tracking never show the guest sign-in card. |
| `node verification/legal-services-browser.mjs` | 25 views passed, including service catalogue/detail, private request detail, provider and admin regressions; zero mutations. |
| `node verification/parcel-delivery-browser.mjs` | 35 responsive views passed; online/pay-driver booking, mocked payment verification, history/tracking, driver lifecycle, manual assignment and error/retry passed. 17 mocked mutation requests, zero real gateway calls. |
| `npm run build` | Passed after final application CSS change. Existing bundle-size warning remains. |
| Root `git diff --check` | Passed; informational line-ending notices only. |

Production browser evidence: `test-artifacts/customer-service-pages/results.json` and the PNGs in that directory. Representative screenshots were visually inspected for matching icons/headings, compact cards, continuous background and navigation clearance. No original reference screenshots were attached to this conversation or found among the existing relevant image artifacts, so direct pixel comparison to the supplied references was not possible; the described defects and actual source were used.

During verification, one earlier state-test assertion expected the old empty paragraph and was updated to the new heading. The parcel browser runner's final recovery step expected an obsolete Refresh status button and now clicks Retry. The new production browser runner was corrected for navigation-time document readiness, guest fixture persistence, CORS preflights, expected CDP cancellation of abandoned requests, and hidden desktop navigation before the final successful run. These were verification-harness corrections, not relaxed application requirements.

No backend source, service flags, authentication rules, availability rules, or booking/tracking business logic was changed. Live backend/gateway integration and deployment were not performed.
