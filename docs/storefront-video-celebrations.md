# Storefront video banners and celebrations

Implementation and verification: **25 October 2026**. No production deployment, production campaign activation, database migration or credential change was performed. The final verification below includes publication to disposable local MongoDB and explicitly authorized synthetic uploads to an isolated Bulkimart Cloudinary folder.

## Architecture and compatibility

The existing Banner remains the media/navigation record. StorefrontExperience remains the theme, promotional campaign and section configuration. Existing marketing permissions, storage, publication actions, history, optimistic revisions, theme resolution, scheduling and 30-second public refresh are reused. There is no additional collection, API resource, scheduler or animation dependency.

The code-review graph tools were unavailable in this session; inspection used repository searches and source reads. Payment, escrow, order and financial implementation files were not changed.

## Admin workflows

### Upload and publish a video

1. Open **Admin → Storefront Studio → Promotional campaigns** and create/edit a campaign. Choose the placement, storefront, device, priority and IST start/end dates.
2. Choose **Upload New Banner**, then **Media type → Video**. Upload or paste a desktop MP4/WebM URL, provide the required image poster/fallback, and optionally provide mobile video and mobile image variants. The local image picker still previews a selected image immediately; the shared upload controls store assets through the protected Studio media endpoint before attachment.
3. Set heading, description, CTA and destination. Autoplay, muted, loop and inline playback default on. Autoplay with unmuted audio is rejected. Include the offer in visible text/poster so audio is optional.
4. Check the mobile/desktop preview. It uses the storefront's media component, including real video playback and failure fallback. Previewing and editing do not publish configuration.
5. **Save draft** uploads/attaches selected artwork and saves a draft campaign. Direct Studio artwork always has `placement=STUDIO`, including hero artwork, so it cannot appear independently before campaign publication. **Publish** validates references/schedules and activates the campaign only within its eligible schedule. Pause/archive use the existing actions.

The **Banner library** offers the same media controls, responsive preview and banner-specific effects, alongside existing product/category/deal/external destination selectors, scheduling, ordering, draft/publish, enable/disable and archive controls. Choose **Homepage hero** there for an independently published hero, or **Studio only** for campaign-controlled artwork. Disable is the Banner model's pause state.

Upload inputs replace media; Remove clears optional media. A required image/poster or desktop video must be supplied before saving a video banner. Closing an editor with unsaved changes prompts before discarding; browser unload is guarded. Upload and server validation errors remain visible and block the affected save. A failed campaign publication retains its saved draft identity for correction.

Saving an existing published Studio record still creates a draft and removes that record from live resolution until republished, as before. Duplicate a campaign to prepare its replacement while keeping the original live.

### Configure a celebration

1. In a theme or promotional campaign, open **Celebration animation**, enable it and choose Snowfall, Confetti, Flower petals or Golden sparkles.
2. Set 1–6 colors, speed, density, opacity and duration. Optional effect start/end dates use IST; the parent record's dates and publication state also gate eligibility.
3. Choose **storefront**, **homepage**, or **campaign page**. Campaign-page scope requires an existing published/enabled deal campaign. Promotional campaigns also support **banner** scope for hero/splash artwork. Banner library effects are always banner-specific; section artwork also renders attached Banner effects. Text announcements cannot use banner-canvas scope.
4. Preview the effect locally, then save a draft or publish. Preview ignores future effect dates to permit inspection, but respects reduced motion. Its controls use the same Canvas renderer as customers. Change an effect setting or disable/re-enable it to replay after its duration finishes.

Storefront and device targeting inherit the containing theme/campaign. Banner effects inherit the existing Banner storefront, category and parent placement. Customer/account profiling was not introduced.

## Schema and APIs

**Banner additions:** optional `mediaType: image|video`, `mobileVideo`, boolean `autoplay`, `muted`, `loop`, `playsInline`, and validated `animation`. `image` remains required and doubles as poster/fallback; `mobileImage` supplies the mobile poster. Existing `video`, heading/subtitle, CTA, destination, schedules, priority and lifecycle fields remain in place. Missing `mediaType` is inferred from legacy `video`, preserving older image and video records.

**StorefrontExperience additions:** `config.animation` for themes and promotional campaigns. It contains:

| Field | Validation |
| --- | --- |
| enabled | Boolean, default false |
| preset | snowfall, confetti, petals, sparkles |
| colors | 1–6 six-digit hex colors |
| speed | 0.2–3 |
| density | Integer 1–100 particles per canvas |
| opacity | 0.05–0.8 |
| duration | Integer 1–120 visible seconds per viewing |
| scope | storefront, homepage, campaign, or banner where applicable |
| campaignId | Valid existing deal reference for campaign-page scope |
| startAt / endAt | Optional timestamps with timezone; end after start |

Unknown effect properties and invalid parameters fail validation. Existing configuration without an effect remains disabled. No data migration or index changes are needed.

Existing `/api/banners` mutations accept the new fields (multipart effect JSON is supported). Existing protected `/api/admin/storefront` draft/action endpoints persist the configuration. `/api/admin/storefront/media` is reused unchanged: raster JPEG/PNG/WebP up to 5 MB, decoded/re-encoded with sharp; MP4/WebM up to 15 MB with matching MIME, extension and container signature, then Cloudinary H.264 processing limited to 15 seconds and 1280px. Video has no local-storage fallback. Supplied video URLs require HTTPS or the supported local upload path and an MP4/WebM pathname; credentials and executable schemes are rejected. Remote URL availability/decodability is handled by the browser fallback, not a server-side fetch.

Public `/api/storefront/experience` adds an `animations` list and responsive/playback/effect fields on public Banner DTOs. It resolves only published, eligible records; paused/archived/expired parents and disabled/broken deal targets suppress their effects. Effect dates participate in refresh boundaries; campaign-page effects carry the target's expiry. The highest-priority applicable global effect wins, with stable ID ordering for ties. Existing publication-conflict rules remain in force. Banner-specific effects stay attached to their artwork.

Public banner listing now uses an explicit allowlist and suppresses expired/invalid effects. Audit actors, history and private descriptions are excluded. GET endpoints remain read-only; existing click tracking is unchanged. Every mutation and upload retains authenticated admin plus `superAdmin` or `manage_marketing` enforcement.

## Runtime behavior

- Only the visible carousel slide mounts its video. Other placements use IntersectionObserver to defer sources until near the viewport and release playback offscreen.
- Loading uses the responsive poster. Playback rejection, media errors or a ten-second loading timeout switch to the image; an unavailable image has a text fallback. Reduced-motion users see the image.
- Effects share a Canvas 2D implementation, cap density at 100 and device pixel ratio at 2, pause in hidden tabs/offscreen, and stop after their visible duration. All frames, observers and listeners are cleaned up.
- One provider chooses the global effect. Stable configuration serialization prevents periodic refresh from restarting or duplicating it; route targeting removes inapplicable effects. Banner canvases are separately scoped to their artwork.
- Canvases have `pointer-events:none` and are hidden from assistive technology. A small **Turn off celebrations / Enable celebrations** control stores the customer preference locally, with an in-memory fallback when storage is denied. No celebration popup was added.

## Initial verification results

| Command / scope | Actual result |
| --- | --- |
| Backend `npm run test:storefront` | **86 passed**, 1 suite |
| Frontend `npm run test:storefront` | **69 passed**, 0 failed |
| Final renderer rerun: `node --test verification/celebration-renderer.test.mjs` | **6 passed**, including visible-duration expiry under low frame rates |
| Frontend `node --test tests/auth-role.test.mjs tests/checkout-ui.test.mjs tests/portal-startup.test.mjs verification/payment-ui.test.mjs verification/razorpay-overlay.test.mjs` | **97 passed**, 0 failed |
| Backend `npm test -- --runInBand --json --outputFile=../test-artifacts/storefront-backend-regression.json` | **54 suites passed, 6 failed; 779 tests passed, 10 failed, 7 skipped** |
| Those 6 backend suites against untouched HEAD source | **Same failures**: 6 suites failed; 35 tests passed, 10 failed, 5 skipped |
| Frontend `node verification/storefront-browser.mjs`, Chrome and Edge separately | Both stopped at DevTools **Page.enable timeout**, before application assertions |
| Backend `npm run build` | Passed: syntax/service-package checks |
| Frontend `npm run build` | Passed; existing large-chunk warning remains |

Focused tests cover compatibility, media flags/variants, draft isolation, publication/pause/archive, effect ranges/presets, schedules/expiry, target eligibility, priority, data minimization, protected upload plumbing/limits, playback rejection, responsive source selection, deferred loading, customer preference, reduced motion, Canvas drawing, visible duration, config refresh, offscreen/hidden pausing and cleanup. At initial implementation, Cloudinary success/error behavior was isolated with a test provider stub and no live upload was attempted. The final verification below adds actual uploads and browser playback. Frontend component tests use the existing hook harness, and renderer tests use a controlled Canvas/clock environment; those suites are not visual browser tests.

The existing backend failures were reproduced using an archived HEAD source snapshot and the unchanged local test files (the main `__tests__` tree is ignored by Git). Matching failures are:

- `order-fulfillment-lifecycle`: audit-field assertion.
- `seller-payment.http`: wholesale catalog authentication expectation.
- `admin-workflows.http`: rider rate write, payout settlement and commission assertions.
- `razorpay-webhook.http`: settlement/idempotency and pending/unknown event assertions.
- `sms.service`: three OTP isolation assertions failing with missing live Shiprocket configuration.
- `checkout-workflow.http`: suite cannot load because its mock lacks `releaseReservedCoins`.

Detailed local logs/JSON are in `test-artifacts/storefront-*.log` and `test-artifacts/storefront-*-results.json` / `storefront-backend-regression.json` (ignored artifacts). Full-suite failures remain outside this feature's scope. The browser and real-provider gaps recorded in the initial table were subsequently investigated as documented below.

## Final verification and confirmed fixes — 25 October 2026

### Browser root cause and harness fixes

Blank-page probes established that browser startup, the remote-debugging port, WebSocket connection, `Browser.getVersion` and `Target.getTargets` worked. The failure occurred before application navigation: sandboxed Windows child processes encountered access-denied errors. Chrome repeatedly lost its GPU process with `0xC0000022`, then exited with “GPU process isn't usable”; page-level `Page.enable` / `Runtime.evaluate` could not complete. Disabling only the GPU sandbox or using in-process GPU did not restore page commands. A diagnostic run with the entire browser sandbox disabled did restore them.

Running Chrome outside the restricted execution host restored **normal browser sandbox** operation. The final application matrix and real-provider acceptance runs used that normal sandbox; no sandbox-disable flag remains in the verification workflow. Edge 155 still stalled on page-level commands even outside the restricted host, while its blank-page sandbox-disable diagnostic succeeded. Edge application verification remains blocked on this installation; no Edge application pass is claimed.

Once application assertions could execute, the existing driver had three reproducible lifecycle problems:

1. It waited for the home shell before checking the splash. The application intentionally defers the home shell until the splash closes, so this could miss the splash entirely. Readiness now recognizes the splash/loading screen before checking the unchanged splash geometry and accessibility assertions.
2. It left a dirty campaign preview open between viewports. The application's correct `beforeunload` protection prevented the next navigation, so later assertions ran against the prior editor. The driver now clicks Cancel and confirms **Discard changes**, verifies the editor closes, and verifies the preview did not publish a campaign.
3. Separate CDP calls could read a header element after a session/configuration transition had replaced it, producing `getComputedStyle(null)`. Style reads now wait for a currently mounted element and retrieve its computed value atomically. Every original expected color, geometry and behavior assertion remains enforced.

The driver also rejects pending commands when its debugging connection closes, includes the failing evaluation expression in diagnostics, and passes through the existing runner's path/width filters for focused reproduction. The final full matrix passed **72 scenarios, zero failures and zero unexpected browser errors**, at widths **320, 360, 390, 430, 768 and 1440**. It reached actual application assertions covering storefront/default/error states, splash/video fallback, category/product browsing, theme refresh, search, cart, checkout, wholesale, and Studio preview/publication using isolated API fixtures. Six focused splash/Studio cases also passed after the lifecycle fix.

No confirmed runtime implementation defect was found. Hashes captured at the start of this verification confirmed that the original 23 implementation files were unchanged before this report update. Payment/order/commission/settlement code and application environment files remain unchanged.

### Real local APIs and authorized Cloudinary verification

Configuration inspection identified account **`ccqcepfo`**, loaded from individual Cloudinary variables in `backend/.env` (`NODE_ENV=development`). Existing process environment values take precedence. No duplicate definitions, separate test configuration or test-folder variable existed. API keys/secrets were never printed or written into reports. The application's existing legacy upload-folder conventions were inspected and left intact.

With explicit user authorization, uploads were constrained to fresh **`bulkimart/storefront-verification/run-<UUID>`** folders. A read-only account ping and image/video prefix queries confirmed each destination was empty. The acceptance process retained the real protected upload route, validation and transcoding options; a test-process-only SDK adapter supplied the authorized folder, random synthetic public IDs and `overwrite:false`. No production configuration changed and no existing assets were overwritten, moved or deleted.

The successful complete upload run used:

`bulkimart/storefront-verification/run-b3147142-95c7-4dc9-9ec7-e6eb1e9c4a9c`

It uploaded a real synthetic WebP poster and browser-generated VP8/WebM video through the actual authenticated multipart endpoint. Cloudinary returned a processed **MP4, 640×240, 1.15 seconds, 21,162 bytes**. A subsequent read-only download verified `avc1` in the MP4 `stsd` sample description and an `avcC` configuration record, confirming H.264 output. Chrome decoded this returned asset and advanced its playback clock with muted, inline, autoplay and loop settings enabled.

The **19-check complete upload workflow passed**. It used the actual Studio UI for media controls, responsive preview, draft save and publication; actual Express permission middleware/services; and a freshly created loopback MongoDB memory server. Draft configuration was absent from the real public experience API. Publication affected only this disposable local database.

A follow-up **22-check acceptance run passed**, reusing those synthetic assets **read-only with zero provider writes**. It additionally exercised animation controls through the actual Studio form, genuine HTTP-404 video failure with a successfully decoded Cloudinary poster, injected browser autoplay rejection, and actual hidden-tab visibility transitions. Checks covered:

- Desktop and mobile preview/source selection; muted inline autoplay and poster fallback.
- Save draft versus published public configuration; real local pause and expiry.
- Snowfall, confetti, petals and sparkles producing nontransparent Canvas pixels from live configuration updates.
- Reduced-motion changes, persistent customer opt-out, campaign-page targeting and route changes.
- One Canvas/animation loop across repeated configuration refresh; no outstanding renderer loop after opt-out, hidden-tab transition, inapplicable route or pause, and one loop after resuming visibility.

The acceptance entry uses a clearly identified synthetic navigation context around the actual production components. It does not claim full application login or transactional checkout coverage. Normal storefront/product/cart/checkout UI behavior was checked separately by the 72-scenario production-build matrix and the existing regression suites; no real payment transaction was attempted.

Two earlier acceptance-driver attempts successfully uploaded their two synthetic assets before failing on test-driver synchronization/serialization. All **six created assets across three unique verification folders** were retained. The final read-only inventory confirms one image and one video in each folder; no existing assets were deleted or modified. Those additional folders are:

- `bulkimart/storefront-verification/run-74ec76d6-188a-453e-a1ce-f6c20d8770ee`
- `bulkimart/storefront-verification/run-3a2553e0-c7f6-4be3-a764-a31fb7ddaccd`

### Final executed checks

| Command / scope | Actual final result |
| --- | --- |
| Backend `npm run test:storefront` | **86 passed**, 0 failed |
| Frontend `npm run test:storefront` | **69 passed**, 0 failed |
| Renderer `node --test verification/celebration-renderer.test.mjs` | **6 passed**, 0 failed; subset of storefront coverage |
| Frontend auth/checkout/startup/payment command from initial table | **97 passed**, 0 failed |
| Backend full suite, rerun with `--runInBand --json` | **54 suites passed, 6 failed; 779 tests passed, 10 failed, 7 skipped** |
| Compare final full-suite failure names/setup error with recorded untouched-HEAD evidence | **Identical** six suites, ten failed assertions and missing `releaseReservedCoins` setup export |
| Chrome `node verification/storefront-browser.mjs`, normal browser sandbox outside restricted host | **72 passed**, 0 failed, 0 unexpected browser errors |
| Focused splash/Studio browser reproduction at 320/390px | **6 passed**, 0 failed |
| `node verification/storefront-acceptance-browser.mjs --cloudinary` | **19 checks passed**, actual protected uploads and real Cloudinary processing/playback |
| `node verification/storefront-acceptance-browser.mjs --media-report=../test-artifacts/storefront-cloudinary-complete.json` | **22 checks passed**, existing synthetic assets read-only; no additional provider writes |
| Backend `npm run build` | **Passed** |
| Frontend `npm run build` | **Passed**, existing large-chunk warning |
| `git diff --check` | **Passed** |

Final evidence lives in ignored `test-artifacts/`: `storefront-final-browser-verified.log`, `storefront/layout/results.json`, mobile/desktop screenshots under `storefront/`, `storefront-final-acceptance.log`, `storefront-cloudinary-complete.json`, `storefront-existing-media-acceptance.log`, `storefront-acceptance-results.json`, `storefront-cloudinary-inventory.json`, `storefront-processed-test-video.mp4`, and `storefront-final-*` suite/build logs and regression JSON. Diagnostic failures are retained separately; no failed attempt is counted as passed.

### Files changed during final verification

- `forntend/verification/storefront-browser.mjs`: confirmed lifecycle/readiness fixes and CDP diagnostics; original application assertions retained.
- `backend/verification/storefront-acceptance-server.mjs`: isolated real-API test server, disposable database and explicitly constrained optional provider uploads.
- `forntend/verification/storefront-acceptance-entry.jsx`: actual Studio/storefront components inside a synthetic local navigation context.
- `forntend/verification/storefront-acceptance-browser.mjs`: real browser/API/provider workflow and read-only follow-up mode.
- `docs/storefront-video-celebrations.md`: this final evidence and limitations report.

### Remaining production-readiness limits

Edge's normal-sandbox renderer remains blocked on this host. Actual iOS Safari, Android devices, PWA/native WebView behavior, slow cellular conditions and long/large real-provider video clips were not exercised. The real provider clip was 1.15 seconds; upload size/type limits and the requested maximum transcoding options remain covered by focused integration tests. The Cloudinary account was not established as a dedicated staging account; writes were limited to explicitly authorized isolated test folders. Full application login and a complete backend transactional checkout cannot be claimed from the synthetic-context acceptance harness, and the six baseline backend suite failures remain unresolved. No production deployment or production campaign activation was performed.

## Files changed

| File | Purpose |
| --- | --- |
| `backend/models/Banner.js` | Additive media/playback/effect fields |
| `backend/controllers/banner.controller.js` | Banner validation and minimized public data |
| `backend/services/storefrontPolicy.service.js` | Effect/media validation |
| `backend/services/storefront.service.js` | Resolve eligible effects and responsive public media |
| `backend/shared/celebration.mjs` | Shared preset/default/eligibility vocabulary |
| `backend/verification/storefront.test.js` | Backend integration and upload tests |
| `forntend/src/modules/Admin/components/StorefrontStudio.jsx` | Integrated media/effect editing and private preview |
| `forntend/src/modules/Admin/components/BannersTab.jsx` | Existing Banner library controls and unsaved handling |
| `forntend/src/modules/Admin/components/StorefrontMediaFields.jsx` | Reused media settings/upload controls |
| `forntend/src/modules/Admin/components/StorefrontEffectFields.jsx` | Reused animation controls |
| `forntend/src/modules/User/components/StorefrontMedia.jsx` | Responsive lazy video, playback and fallback |
| `forntend/src/modules/User/components/Celebration.jsx` | Canvas lifecycle and customer preference |
| `forntend/src/utils/celebrationRenderer.js` | Shared bounded particle renderer |
| `forntend/src/modules/User/context/StorefrontContext.jsx` | Existing refresh integration and route resolution |
| `forntend/src/modules/User/components/HeroBanner.jsx` | Slide effect and playback pause |
| `forntend/src/modules/User/components/SplashCard.jsx` | Attached banner effects |
| `forntend/src/modules/User/components/StorefrontSections.jsx` | Lazy section media and attached effects |
| `forntend/src/modules/User/Storefront.css` | Responsive media/overlay styling |
| `forntend/verification/storefront-ui.test.mjs` | Media, admin and lifecycle tests |
| `forntend/verification/celebration-renderer.test.mjs` | Canvas and routing tests |
| `forntend/package.json` | Include renderer tests in storefront command |
| `docs/storefront-studio.md` | Current feature guide link |
| `docs/storefront-video-celebrations.md` | This implementation/verification report |
