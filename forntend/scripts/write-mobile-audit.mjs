import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mobileRoutes } from './mobile-route-inventory.mjs';

const root = new URL('../../', import.meta.url);
const artifacts = new URL('test-artifacts/mobile-native/', root);
const files = await readdir(artifacts);
const reports = await Promise.all(files.filter(name => /^final(?:-[a-z]+)*-\d+\.json$/.test(name)).map(async name => ({ name, ...JSON.parse(await readFile(new URL(name, artifacts), 'utf8')) })));
const widths = [320, 360, 390, 430, 768, 1280];
const records = reports.flatMap(report => report.rows.map(row => ({ ...row, report: report.name })));
const verified = (path, width) => records.some(row => row.path === path && row.viewport === width && !row.failed && row.scroll <= width + 1 && !row.wide?.length && row.controls?.every(control => width > 768 || control.size >= 16));
const role = path => path.startsWith('/seller') ? 'Seller' : path.startsWith('/delivery') ? 'Delivery' : path.startsWith('/admin') ? 'Admin' : 'Customer / public';
const layout = path => path.includes('guest') ? `${role(path)} authentication` : path.startsWith('/seller') ? 'Seller gate → drawer + workspace' : path.startsWith('/delivery') ? 'Delivery gate → scroll viewport + role tabs' : path.startsWith('/admin') ? 'Admin gate → sidebar + workspace' : path.startsWith('/checkout') ? 'Customer shell; checkout owns footer' : path.includes('?product=') || /^\/wholesale\/[^/]+$/.test(path) && !path.endsWith('/cart') ? 'Customer shell → shared product overlay' : path.startsWith('/review/') ? 'Customer shell → review overlay' : 'Customer scroll shell + bottom navigation';
const inventory = mobileRoutes.map(path => `| \`${path}\` | ${role(path)} | ${layout(path)} | ${widths.map(width => verified(path, width) ? '✓' : 'Unverified').join(' | ')} |`).join('\n');
const changed = execFileSync('git', ['diff', '--name-only'], { cwd: fileURLToPath(root), encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
const completed = widths.map(width => ({ width, passed: mobileRoutes.filter(path => verified(path, width)).length }));
const evidence = reports.map(report => `| [${report.name}](test-artifacts/mobile-native/${report.name}) | ${report.rows.length} recorded observations (including prior widths in the same run) | ${report.rows.filter(row => row.failed).length} failures | ${report.errors.length} uncaught exceptions |`).join('\n');

const report = `# Bulkimart mobile-native responsiveness audit

Date: 2026-10-17. Local workspace audit; no commit, push, deployment or production data changes.

## Scope and acceptance limits

Audited the actual state/path routers in App, UserContext/LandingPage, SellerContext/DashboardPage, Delivery routes and AdminContext/Admin routes/sidebar/generic modules. The working tree was clean before changes. Code-review-graph tools were unavailable in the session, so the documented file-search fallback was used. No new UI dependency was added.

The route checklist below distinguishes browser geometry verification from complete functional acceptance. A check means the local production UI rendered with isolated API fixtures, document width fit the viewport, selected layout containers fit, initial scale was 1 and visible mobile text inputs measured at least 16px. It does not mean every data state or operation on that route was exercised. Admin coverage primarily exercises existing empty/error views; only product views have populated fixtures. Live integrated backend/payment testing and physical-device acceptance remain outstanding. Final acceptance recorded 143 route/state entries × six core widths (858 checks), 138 main/supplemental interaction-state checks and 60 additional-width checks, with no remaining failures in those final matrices.

## Root causes and implementation

- Search flex children retained intrinsic input widths, clipping the header on 320px phones. Inputs now shrink; back, image and voice controls retain space and suitable touch targets.
- Seller dashboard action and chart/product grids kept desktop columns inside narrow scroll containers. Named responsive grids now stack below 768px; workspace padding, shrinkable cards, product codes, wrapping stock filters and readable sales metrics preserve access to their contents.
- Product editor navigation occupied most of short phone dialogs and variant fields kept five columns. Mobile editor tabs scroll horizontally, the sidebar has bounded height, variant fields use two columns, and the editing pane can shrink and scroll. The desktop editor keeps five columns.
- Account sheet styles leaked negative margins into checkout headers and order tracking cards. Scoped receipt/checkout spacing fixes clipped edges and keeps long order references readable. The product-loading header now fits zero-padding customer layouts.
- Delivery's mobile shell overrode its dynamic height with percentage height. It now follows the dynamic viewport; earnings values wrap in three shrinkable columns, payout actions wrap, bottom navigation reserves safe-area space, and offer/deposit sheets have bounded height and internal scrolling.
- Admin table cards used inline overflow:hidden, leaving wide columns unreachable. Direct table regions now scroll horizontally within their existing borders; table wrappers have keyboard focus and accessible region labels. Narrow dashboard grids stack and action/filter rows wrap. An explicit override is needed for legacy inline overflow/grid styles; no page-level overflow hiding was introduced.
- Seller and Admin text-input rules stopped at 767px while tablet layout began at 768px. Text controls now keep the 16px focus-zoom mitigation through 768px without changing sidebar breakpoints.
- Shared support conversations use bounded dynamic height, shrinkable scrolling content, long-text wrapping and a labeled close target. Customer account drawers and Admin authentication also follow dynamic height. Seller closed navigation is inert, exposes expanded/current state, and Delivery navigation exposes its current destination.
- Global reduced-motion support covers legacy transitions/animations. Existing Customer bottom tabs, Seller drawer/desktop sidebar and Delivery tabs retain their destinations and role separation.

Responsive thresholds remain the existing 767/768px sidebar boundary, 768px mobile control threshold and existing product/tablet/desktop grids. Additional widths were verified without inventing a competing layout system. Desktop customer shells also use dynamic height. Safe-area handling is applied to relevant shells, bottom navigation and primary sheets.

## Zoom policy

There is one viewport meta tag: width=device-width, initial-scale=1, viewport-fit=cover. Pinch zoom remains available by policy; no maximum-scale or user-scalable restriction was added. Buttons, links, inputs, selects, textareas and explicit button roles use touch-action:manipulation to suppress accidental double-tap zoom while allowing pan/pinch gestures. The custom hero swipe surface now explicitly allows pan-y pinch-zoom. Maps retain their cooperative gesture policy. No document-wide gesture listener, zoom-reset loop, text-selection restriction or scrolling restriction was added.

The browser harness checked initial scale and sent synthetic double taps to a basket control; observed scale remained 1. Synthetic pinch commands were accepted by headless desktop Chromium but returned scale 1, so pinch execution is inconclusive in this emulator. This is not evidence that physical Safari/Android pinch is disabled. Preserving magnification avoids the low-vision cost of disabling zoom. Real iOS Safari focus zoom, Android Chrome accessibility overrides, physical safe areas, browser chrome and native keyboards still need device testing. Short viewport/focus checks approximate available space and do not emulate a real keyboard.

## Route inventory and role coverage

Inventory source: forntend/scripts/mobile-route-inventory.mjs. Customer route entry delegates to LandingPage; Seller and Admin tabs are derived from actual dispatchers/navigation instead of assumed router configuration. Query rows identify UI states, rather than new route destinations. 

Current geometry coverage: ${completed.map(row => `${row.width}px: ${row.passed}/${mobileRoutes.length}`).join('; ')}.

| Route / state | Role | Layout | 320 | 360 | 390 | 430 | 768 | 1280 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${inventory}

Dynamic category URL families grocery--<path>, ecommerce--<path>, and /categories/<slug> were inspected and sampled with fixture slugs. Their live database-driven slug set cannot be enumerated without a safe live catalogue. / redirects to /grocery--home. /profile aliases account; Admin aliases and retired generic destinations follow their existing dispatcher behavior. Unknown customer paths fall back to home, unknown Delivery subpaths to dashboard, and unknown approved Seller tabs show Page unavailable. Authentication is role/state-driven: there are no separate customer password-recovery routes in these routers. Admin uses its existing password form. Seller registration/OTP and Delivery onboarding are states within their respective portal roots.

## Interaction and state verification

The final-native reports record the actual 16 interaction scenarios per viewport: Seller product editor, bulk upload dialog and drawer; Delivery deposit sheet; six Customer profile sections (profile, wallet, Coins, addresses, support, privacy); checkout address entry; committed-payment recovery; image-search sheet; basket instructions; customer order-detail overlay; active Delivery view. A further seven supplemental states per viewport cover logout, initial Seller/Delivery onboarding, Seller pending approval, retail variant fields, Wholesale-only creation and the populated existing-product offer selector. These 42 supplemental checks passed; saves/uploads and later onboarding steps were not submitted. Each is also checked at 360px height where applicable, with focus/internal scrolling when a text field exists. This includes landscape-sized 430×360 and 768×360 checks; no physical orientation sensor was used.

The basket fixture contains Quick Commerce, E-Commerce and Wholesale groups with independent item quantities/MOQ and authoritative totals (₹600 items + ₹120 delivery = ₹720). Recovery restores an already committed order, refreshes /checkout, displays pending/reconciliation-required server payment state and exposes no new Place/Pay/Done action. Browser test APIs are intercepted before network dispatch; real OTPs, uploads, payments and orders are never sent. Application network failures for external sockets/fonts/maps are intentional test isolation, not evidence of live service health. Console diagnostics were inspected: the only distinct error in the complete route sweeps was [ADMIN] fetch unread count failed: Audit fixture: this endpoint has no populated fixture, caused by the deliberate 503 fixture. The runs recorded zero uncaught runtime exceptions.

Existing frontend regression tests cover mixed/empty/error baskets, quantities, variants, retail/Wholesale operations, COD/wallet/online checkout and committed-payment recovery. Backend integration suites use isolated test databases. No live COD/wallet/online payment transaction or real catalogue mutation was performed.

## Automated checks and evidence

- Frontend unit/component tests: 223 passed, 0 failed, 0 skipped. Command: node --test --test-concurrency=1 with all scripts/*.test.mjs except the separately executed browser harness. Log: test-artifacts/mobile-native/frontend-tests.log.
- Backend: npm test -- --runInBand; 58 suites passed, 737 tests passed, 7 skipped (744 total), 330.348s. No backend source changes.
- Production frontend build: passed. The existing large-JavaScript-chunk warning remains. Log: test-artifacts/mobile-native/build.log.
- git diff --check: passed; Git emits repository line-ending conversion notices.
- Existing browser regression components passed independently: Customer 81 checks and dialogs 4 checks (existing-mobile-suite.log), Seller 36 checks (existing-seller-suite.log), startup 4 checks (existing-startup-suite.log). The combined npm run test:mobile invocation was interrupted during an earlier Seller run; its remaining components were then completed independently. Supplemental runs are recorded separately. Incomplete earlier runs are not counted as successful final acceptance.
- Additional representative viewport matrix: 60 checks passed at 375, 414, 480, 1024 and 1440px with zero uncaught exceptions; reports verified-extended-*.json. Combined with the main sweep this covers all requested widths.

The harness now takes a temporary frozen copy of dist before serving it. Earlier concurrent builds invalidated files during navigation and produced infrastructure timeouts; these runs are retained for diagnosis, not counted as successful acceptance. Supplemental fixture corrections wait for Wholesale product loading to finish before clicking Add, and avoid automatically reauthenticating a fixture immediately after logout; the successful final-supplemental and final-extra reports replace those earlier failed attempts. Geometry checks wait for finite entry animations before measuring; this avoids incorrectly reporting the normal 280ms order overlay slide as final overflow. File-picker font sizes are excluded from the text-input zoom assertion.

| Final evidence | Observations | Geometry/interaction failures | Runtime exceptions |
| --- | --- | --- | --- |
${evidence}

Screenshot evidence is local under test-artifacts/mobile-native (ignored by Git). Before captures exist for home, basket, checkout, Seller dashboard/products/stock and Delivery earnings. After captures include those pages and the interaction scenarios. Examples: [checkout before](test-artifacts/mobile-native/before-_checkout.png), [checkout after](test-artifacts/mobile-native/after-_checkout.png), [Seller products before](test-artifacts/mobile-native/before-_seller_products.png), [Seller products after](test-artifacts/mobile-native/after-_seller_products.png), [product editor after](test-artifacts/mobile-native/after-_seller_products_layout_add.png), [order details after](test-artifacts/mobile-native/after-_orders_layout_detail.png). These are headless Chromium screenshots with remote fonts/resources intentionally blocked.

Reproduce: build in forntend, then node scripts/mobile-layout.test.mjs --full --label=final; node scripts/mobile-layout.test.mjs --native --label=final-native; node scripts/mobile-layout.test.mjs --native --supplemental --label=final-supplemental; node scripts/mobile-layout.test.mjs --full --extended --label=verified-extended. npm run test:responsive runs the full, interaction, supplemental and extra-width matrices. Requires Node with WebSocket and installed Chrome/Edge; CHROME_BIN can select the browser. Regenerate this report with node scripts/write-mobile-audit.mjs.

## Outstanding verification and known limits

- No safe running backend/authenticated browser test accounts were available. Real populated Admin dashboards/tables, all Admin editing dialogs and database-backed error/success transitions remain unverified in-browser; each Admin checklist check covers its fixture empty/error shell, except populated product views. Missing aggregate fixtures deliberately return 503 rather than invalid successful payloads.
- State-only campaign/promotion landing overlays, real notification/media payloads, reviews with uploads, digital download delivery, live search/filter/date-picker result sets, coupon/Coins eligibility variations, real payment-provider UI, refunds and success confirmation after a real checkout remain source-audited and/or unit-covered, with integrated browser acceptance outstanding.
- Seller onboarding document/address/bank submission steps, positive populated wholesale term editors, and Delivery onboarding uploads/return-pickup offers depend on authenticated backend state and safe files. Unless a supplemental report explicitly records one, they were source-audited but not exercised in the browser. No real operational status mutation was performed.
- Real GPS/maps/navigation gestures and offline/reconnection hardware behavior were not exercised; the active-delivery fixture shows the existing unavailable-map state.
- No physical iOS/Android devices, native mobile keyboards or Safari engine were available. No claim of those tests is made. Synthetic pinch behavior is inconclusive as described above.
- Any checklist cell marked Unverified has no passing final browser observation at that width; it remains outstanding rather than being inferred from a shared-header fix.

## Preservation of business behavior

All application changes are CSS, layout/presentation properties or accessibility/navigation semantics. Backend APIs, auth/session providers, shopping/cart hooks, payment/committed-checkout utilities, calculations, inventory and order processing were left unchanged. No API endpoint, request body, route destination, role permission or financial calculation was changed. Evidence: unchanged backend/shared/context/hooks/payment utility paths in git diff, 223 passing frontend regressions, 737 passing backend tests and the three-channel basket/pending-payment browser scenarios above. No dependencies, credentials or production settings were changed.

## Changed files

${changed.map(path => `- [${path}](${path})`).join('\n')}

New audit support: mobile-route-inventory.mjs, write-mobile-audit.mjs and this report. Browser evidence stays in the workspace; no commit or deployment was made.
`;
await writeFile(new URL('MOBILE_NATIVE_RESPONSIVENESS_AUDIT.md', root), report);
console.log(JSON.stringify({ routes: mobileRoutes.length, coverage: completed, reports: reports.length }, null, 2));
