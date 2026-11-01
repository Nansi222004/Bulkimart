# Android Test Report — Bulkimart Seller

**Result: no tests have been run.** The security gate failed (`FINAL_FEATURE_AUDIT.md` §1), so no install, build, launch, lint or device test was performed. Every row below is a plan with status **Not run — blocked by gate**. Never change a row to Passed without an actual run, recording the date, device, build and staging seller.

## Static checks that were performed

| Check | Method | Result |
|---|---|---|
| Every relative import resolves | text search over all `.js` files | Pass |
| Every named import is exported; every default import has a default export | text search | Pass |
| Every third-party import is declared in `package.json` | text search | Pass |
| Every navigation target is a registered route | text search | Pass |
| No imports outside `mobile-seller/`; no circular imports through services/utils | text search + layering | Pass |
| Money helpers never default missing values to ₹0 | text search | Pass |

## Build tests (Not run — blocked by gate)

| ID | Test | Status |
|---|---|---|
| B-01 | `npm install --ignore-scripts`, then reviewed rebuild | Not run |
| B-02 | Android project generated with `com.Bulkimart.seller` | Not run |
| B-03 | Metro starts | Not run |
| B-04 | `assembleDebug` succeeds | Not run |
| B-05 | `assembleRelease` / `bundleRelease` succeed (signed) | Not run |
| B-06 | Native modules link (keychain, screens, svg, netinfo, async-storage, image-picker, documents picker, geolocation, firebase) | Not run |
| B-07 | `npm run lint` clean | Not run |
| B-08 | No red-box or JS errors on launch | Not run |

## Functional tests (staging seller; Not run)

| ID | Area | Cases |
|---|---|---|
| F-AUTH | Auth | approved, incomplete, pending, under_review, rejected, suspended, deactivated, customer account, expired token, logout, restart restore |
| F-DASH | Dashboard | figures equal web for the same seller; missing value shows '—' |
| F-PROD | Products | create; edit; delete; 5 photos; camera; gallery; upload failure; duplicate-create warning; replace photos; return window above category limit rejected |
| F-STOCK | Inventory | adjust up/down; 409 conflict; multi-variant note |
| F-ORD | Orders | every `permittedActions` action; reject with reason; courier dispatch with AWB; manual rider; Shiprocket (test order only); tracking; invoice |
| F-FIN | Finance | earnings/ledger/payout values equal web; payout idempotency retry; tax statement |
| F-RET | Returns | approve; reject (reason); rider pickup; Shiprocket pickup (test); cancel; mark received; refund shown verbatim |
| F-ONB | Onboarding | full chain; failed step 3 → retry resumes at 3; documents PDF + image; GST choices |
| F-SUP | Support | create with attachments; reply; reopen resolved; closed is read-only |
| F-NOT | Notifications | inbox routing per type; push foreground alert; background tap; cold-start tap; logout removes token |
| F-SET | Settings | channels toggle; wholesale request; same-day validation; logo/banner; GPS pin (grant / deny / never-ask) |
| F-WHS | Wholesale prices (Stage 7) | hidden without an approved Wholesale channel; enable offer; MOQ above stock rejected; tier order/price rules; save sends product version; 409 after editing on web; turning an offer off keeps retail stock |
| F-ADM | Advertising views and clicks (Stage 7) | not-started message; counts match the web for the same campaign; refresh; error state |
| F-ADS | Advertising | create draft; product limit; category options; submit with package confirmation; 409 on a changed package; cancel unpaid; cancel paid (test); refund progress display |
| F-FAQ | FAQs | answer; empty answer rejected |
| F-ENV | Config | debug build with no staging URL shows `API_NOT_CONFIGURED`, makes no production call |

## Device tests (physical devices; Not run)

| ID | Case |
|---|---|
| D-01 | Small (≈360 dp) and large (≈412 dp+) screens; gesture and 3-button navigation |
| D-02 | Camera / notifications / location permission denial and "don't ask again" |
| D-03 | Offline banner, retry after reconnect |
| D-04 | Keyboard: forms scroll, no hidden inputs |
| D-05 | Android back on every stack; exit from tabs |
| D-06 | PDF picker (Drive / Downloads) |
| D-07 | Session expiry while backgrounded |

Workflows 1–12 from `STAGE_4_INTEGRATION_AUDIT.md` §6 are also to be run end to end.
