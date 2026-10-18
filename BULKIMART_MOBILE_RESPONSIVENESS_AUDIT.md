# Bulkimart mobile responsiveness, zoom and modal audit

## Outcome and scope

Audited Customer, Seller, Delivery and Admin routing/layouts, authentication, shared CSS, dialogs, tables, navigation, forms and critical expanded states. Fixed shared positioning and viewport defects without changing backend APIs, database schemas, authentication rules, roles, inventory, checkout, payments, delivery transitions or shipping logic.

All final checks listed below passed. These were local Chromium production-build checks using mocked APIs and synthetic records, not physical Android/iOS or production-account tests. Existing Wholesale and delivery/Shiprocket changes in the workspace were preserved.

## Root causes: shared issues

1. **Logout confirmations deliberately became bottom-aligned on mobile.** The original final rule in `forntend/src/components/feedback/feedback.css` set `.feedback-backdrop { align-items:flex-end }` below 480px and changed its border radii into a sheet. This affected all four portals. Removing that rule restores centered confirmations; their content now fits the available overlay height.
2. **Portal CSS changed the document layout globally.** The original `body` rule in `modules/Seller/Seller.css` overrode the shared responsive body with flex centering and a dark background. App imports all portal routes/styles eagerly, so the rule also affected other portals. Document sizing now belongs to `src/index.css`; Seller styling stays on Seller containers.
3. **Most overlays were attached to page/container positioning contexts.** Seller and Delivery overlays used absolute positioning inside full-height, overflow-constrained portal shells. Other dialogs used fixed positioning inside trees containing transforms, animation and stacking contexts. Their sizing depended on a parent rather than the visible screen.
4. **Keyboard/toolbar changes were not reflected in dialog geometry.** Layout viewport dimensions and `vh` constraints alone do not describe a keyboard-reduced or panned visual viewport. The new shared hook tracks VisualViewport resize/scroll events; overlays use its actual rectangle without scaling content.
5. **Mobile input protection stopped at 768px.** At a simulated 844px landscape width, Customer, Delivery and Admin auth controls fell back to 13–14px. Existing control rules now also apply to coarse-pointer devices, including landscape phones and touch tablets. Larger OTP typography is retained.
6. **Browser text autosizing had no shared policy.** The document now uses `text-size-adjust:100%` and its WebKit counterpart. This targets automatic text inflation; it does not disable manual browser zoom or reduce the global font size.

The existing viewport meta was already correct: `width=device-width, initial-scale=1, viewport-fit=cover`. It was preserved. There is no maximum-scale or user-scalable restriction. Existing border-box sizing was also preserved; root flex sizing now explicitly permits shrinking with `min-width:0`.

## Root causes and findings by portal

| Portal | Findings and targeted changes |
| --- | --- |
| Customer | Authentication used `100vw`, and floating decorative blobs expanded the auth container's internal scroll width to about 404px at a 320px viewport. Auth now uses available width, with only its noninteractive decoration clipped in a separate aria-hidden layer. Account/address/order/checkout/product, support, image/voice search, notification and photo overlays use the shared portal layer. Existing intentional full-bleed profile cards, carousels and bounded scrolling regions were retained. |
| Seller | The login card already had responsive widths and 16px inputs in the baseline. The reported excessive portrait zoom was **not reproduced** in the current local build; no invented fixed-width/scale cause is claimed. Global body leakage was removed, and the authentication page now has a bounded dynamic height and vertical scrolling. Product/bulk upload, order, account/profile, Wholesale, notifications and order-ring overlays use the shared layer. |
| Delivery | Incoming-order, return-pickup and cash-deposit sheets were positioned against the app frame. They now use body portals and visible-viewport bounds. The active-delivery overlay is also migrated. Existing pickup, OTP, maps, status, earnings, location and bottom-nav behavior was retained. Touch-landscape inputs retain 16px minimum text. |
| Admin | Existing sidebar collapse, responsive workspace grids and bounded table scrolling were retained after verification. Management forms/dialogs now escape workspace stacking contexts through the shared portal. Modal tables keep controlled horizontal scrolling, including legacy cards with inline overflow settings. Auth inputs retain 16px text on touch-landscape screens. |

A 320px baseline inspected 143 discovered routes. It found no page-wide horizontal overflow, initial scale other than 1, or undersized visible controls in those portrait states. This distinguishes existing working layouts from defects found in dialogs and landscape testing. No screenshots were attached as accessible files to this turn; final screenshots were generated from the local build instead.

## Modal implementation and viewport behavior

`src/components/ModalPortal.jsx` replaces **57 overlay call sites in 44 files** with a shared body portal. Existing dialog children, inputs, handlers, buttons and intended sheet/drawer alignment are retained. The shared layer supplies:

- Fixed visible-viewport bounds, safe-area padding and a stacking order above navigation/maps and below confirmations.
- Content height constraints and internal scrolling for legacy inline vh heights.
- Focus containment and restoration, preserving existing specialized Escape/close handlers.
- A shared nested scroll lock: closing a child confirmation does not unlock the page behind its still-open parent. The original body overflow and root inert state are restored after the final layer closes.
- Mobile/coarse-pointer form text at 16px; existing larger OTP sizes remain intact.

`FeedbackProvider` uses the same viewport and nested-lock infrastructure, retaining its confirmation actions, busy/error behavior, Escape support, initial focus and Tab handling. Logout confirmations remain centered at narrow widths. Intentional drawers, photo viewers, account panels and operational bottom sheets retain their own presentation rather than all becoming centered cards.

## Exact frontend files changed in this task

Shared infrastructure and styles:

| File | Purpose |
| --- | --- |
| `forntend/src/components/ModalPortal.jsx` | New shared portal, bounding, focus and stacking wrapper. |
| `forntend/src/components/ModalPortal.css` | Safe-area padding, visible-height constraints, modal controls, bounded Admin table scrolling and preserved 430px Delivery desktop sheet width. |
| `forntend/src/hooks/useVisualViewport.js` | New resize/pan tracking with CSS fallback when VisualViewport is unavailable. |
| `forntend/src/utils/modalLayer.js` | New shared nested scroll/inert lock and active-layer tracking. |
| `forntend/src/components/feedback/FeedbackProvider.jsx` | Reuses visible viewport and nested locking for all confirmations. |
| `forntend/src/components/feedback/feedback.css` | Removes mobile bottom alignment and bounds confirmation height. |
| `forntend/src/index.css` | Shared text autosizing policy and root min-width. |
| `forntend/src/modules/Seller/Seller.css` | Removes global body override; dynamic auth height/scrolling; touch-landscape control text. |
| `forntend/src/modules/User/User.css` | Available-width auth, decoration-only clipping and touch-landscape control text. |
| `forntend/src/modules/User/pages/AuthPage.jsx` | Adds the noninteractive decoration wrapper. |
| `forntend/src/modules/Delivery/Delivery.css` | Extends existing input protection to coarse pointers. |
| `forntend/src/modules/Admin/SuperAdmin.css` | Extends existing input protection to coarse pointers. |

The following files change only their overlay wrapper/import to use `ModalPortal` in this task; existing operations and event handlers remain intact:

- `forntend/src/components/NotificationPopup.jsx`
- `forntend/src/components/support/TicketDetailModal.jsx`
- `forntend/src/modules/User/components/ImageSearchSheet.jsx`
- `forntend/src/modules/User/components/LandmarkImagePicker.jsx`
- `forntend/src/modules/User/components/LocationPromptModal.jsx`
- `forntend/src/modules/User/components/NotificationDrawer.jsx`
- `forntend/src/modules/User/components/VoiceSearchModal.jsx`
- `forntend/src/modules/User/pages/CheckoutPage.jsx`
- `forntend/src/modules/User/pages/OrderTrackingPage.jsx`
- `forntend/src/modules/User/pages/ProductDetailPage.jsx`
- `forntend/src/modules/User/pages/ProfilePage.jsx`
- `forntend/src/modules/Seller/components/AccountTab.jsx`
- `forntend/src/modules/Seller/components/BulkUploadModal.jsx`
- `forntend/src/modules/Seller/components/NotificationDrawer.jsx`
- `forntend/src/modules/Seller/components/OrdersTab.jsx`
- `forntend/src/modules/Seller/components/ProductModal.jsx`
- `forntend/src/modules/Seller/components/ProfileTab.jsx`
- `forntend/src/modules/Seller/components/SellerOrderRingModal.jsx`
- `forntend/src/modules/Seller/components/WholesaleOfferSelector.jsx`
- `forntend/src/modules/Delivery/components/DepositModal.jsx`
- `forntend/src/modules/Delivery/components/OrderPingModal.jsx`
- `forntend/src/modules/Delivery/components/ReturnPickupPingModal.jsx`
- `forntend/src/modules/Delivery/pages/ActiveDeliveryPage.jsx`
- `forntend/src/modules/Admin/components/BannersTab.jsx`
- `forntend/src/modules/Admin/components/CampaignsTab.jsx`
- `forntend/src/modules/Admin/components/CategoriesTab.jsx`
- `forntend/src/modules/Admin/components/ConsumerOrdersTab.jsx`
- `forntend/src/modules/Admin/components/CouponsTab.jsx`
- `forntend/src/modules/Admin/components/CustomerActivityLogTab.jsx`
- `forntend/src/modules/Admin/components/DeliveryActiveOpsTab.jsx`
- `forntend/src/modules/Admin/components/DeliveryAssignmentTab.jsx`
- `forntend/src/modules/Admin/components/DeliveryTab.jsx`
- `forntend/src/modules/Admin/components/NotificationBroadcasterTab.jsx`
- `forntend/src/modules/Admin/components/PayoutsTab.jsx`
- `forntend/src/modules/Admin/components/PromotionPackagesTab.jsx`
- `forntend/src/modules/Admin/components/ReturnsTab.jsx`
- `forntend/src/modules/Admin/components/SectionModuleTab.jsx`
- `forntend/src/modules/Admin/components/SellerDetailModal.jsx`
- `forntend/src/modules/Admin/components/SellerPromotionsTab.jsx`
- `forntend/src/modules/Admin/components/TicketsTab.jsx`
- `forntend/src/modules/Admin/components/UsersTab.jsx`
- `forntend/src/modules/Admin/components/UserWalletsTab.jsx`
- `forntend/src/modules/Admin/components/VendorFinancialsTab.jsx`
- `forntend/src/modules/Admin/components/VendorOrdersTab.jsx`

No dependencies or backend files were changed by this UI task. The root report itself is new. Existing local QA directories are ignored by repository policy; new `tests/modal-layer.test.mjs` and `tests/visual-viewport.test.mjs`, browser harness updates and the one-time overlay migration utility remain locally available there without staging changes.

## Final verification

| Check | Actual result |
| --- | --- |
| Frontend unit/component/static regressions | **191 passed**, zero failures. Covers auth/roles, checkout, services, Seller profile/Wholesale, product detail, assignment UI, image search, notifications, sockets, feedback and native-dialog prohibition. |
| Complete discovered route sweep | **286 passed**: all 143 routes at 320px and 1280px. |
| Critical route matrix | **175 passed**: 25 representative screens at 360, 375, 390, 414, 430, 768 and 1440px. |
| Expanded operational states | **64 passed** at 320, 390, 768 and 1280px: product/variant/bulk forms, drawers, profile panels, cash-deposit sheet, checkout/address/recovery, image search, cart instructions, order detail and active delivery. |
| Confirmation interactions | **48 passed** at 320, 360, 375, 390, 414, 430, 768 and 1280px. Four-portal logout, cancel/confirm, Escape, focus trapping/restoration, centering, moderation/delete validation, busy/error/retry and short-height bounds. |
| Touch authentication viewport matrix | **36 passed**: all four auth portals at 320, 390 and 844px, each at heights 420, 320 and 956px. Includes explicit touch/coarse-pointer emulation, safe-area overrides, focused controls, scale 1 and minimum input sizes. |
| Isolated recovery checks | **21 passed** for previously timed-out Admin routes and Wholesale details at 320, 414 and 1280px. |
| Production resource audit | **32 passed** across four portals at 390/1280px; zero failed same-origin production JS/CSS/image/document resources. |
| Delivery desktop preservation | **3 passed** at 390/768/1280px after the final shared CSS adjustment; includes short-height bounds and an explicit 430px desktop sheet-width check. |
| Production build | Passed. Existing large-chunk warning remains. |
| `git diff --check` | Passed. |

Final browser runs recorded zero uncaught JavaScript exceptions/native browser dialogs. Some broad Admin route fixtures deliberately return an unavailable-fixture API response and log that known error state. External fonts, map/provider traffic and live sockets were intentionally intercepted/blocked. Those expected mocked failures are not presented as live-service success. A fixture image was changed to an actual public asset for the resource audit.

Initial long browser runs were stopped after CDP evaluation timeouts while awaiting animation promises across navigation. The harness now waits for product data and finishes finite cosmetic animations before measuring final geometry; reduced-height checks wait for the React visual-viewport update. The affected routes passed isolated reruns and the complete final sweep. Earlier failed/aborted runs are not counted as passing results.

Commands and evidence:

```text
npm run build
node --test tests/feedback.test.mjs tests/native-dialogs.test.mjs tests/auth-role.test.mjs tests/checkout-ui.test.mjs tests/service-ui.test.mjs tests/seller-profile-wholesale.test.mjs tests/product-wholesale.test.mjs tests/delivery-assignment.test.mjs tests/image-search-ui.test.mjs tests/seller-notifications.test.mjs tests/socket-ui.test.mjs tests/modal-layer.test.mjs tests/visual-viewport.test.mjs
node tests/mobile-layout.test.mjs --full --widths=320,1280 --label=responsive-all-routes
node tests/mobile-layout.test.mjs --feedback --widths=320,360,375,390,414,430,768,1280
node tests/mobile-layout.test.mjs --native --widths=320,390,768,1280
git diff --check
```

The focused route, viewport and resource commands and complete outputs are in the copied logs under `test-artifacts/mobile-responsive/`. Per-route JSON evidence is in `test-artifacts/mobile-native/` with `responsive-*` labels. Screenshots are in `test-artifacts/mobile-responsive/responsive-final-*` and `test-artifacts/native-dialogs/`. These artifacts are local and ignored by Git.

Visually inspected final 320px Seller, Delivery and Admin authentication screenshots and the centered Seller logout screenshot. All form cards/primary actions fit the viewport. The browser matrix additionally measures Customer layouts and four-portal confirmation geometry.

## Android, iOS, accessibility and remaining limits

- All execution used **headless Chromium on Windows with browser emulation**, not physical Android Chrome or iOS Safari. No Safari/WebKit engine was available; iOS keyboard focus-zoom and native OS text/accessibility settings require real-device follow-up.
- Short-height and visual-viewport pan tests simulate keyboard/toolbars; they do not launch an actual mobile keyboard. Landscape geometry was tested with a touch/coarse-pointer viewport at 844px.
- Safe-area emulation was supported and exercised. Standalone display-mode override was attempted but did not become active in this browser. No installable application manifest/PWA registration was found; the Firebase messaging service worker is not an installable-PWA verification. Installed standalone mode remains unverified.
- Viewport markup preserves manual zoom and controls retain manipulation/pinch-compatible gesture policy. The headless pinch command was acknowledged but scale remained 1; physical pinch zoom was **not** positively verified. No zoom restriction was added.
- The route inventory covers current discovered routes and aliases; data-dependent dialog variations and every possible long production record were not exhaustively opened. Fixtures test representative operational states, including API errors. Real payment, camera, voice recognition, GPS, maps, shipping providers and account mutations were not executed.
- The knowledge-graph tools were unavailable, so code inspection used targeted searches as the repository's documented fallback.

## Business and workspace confirmation

This task changes frontend presentation, overlay mounting, focus and viewport behavior only. Existing routes, authentication and role checks, API requests, form payloads, confirmation callbacks, checkout/payment behavior, Seller inventory/order actions, Delivery OTP/status/location workflows and Admin data-management operations remain intact. No production data was used or mutated. No commit, push or deployment was performed.
