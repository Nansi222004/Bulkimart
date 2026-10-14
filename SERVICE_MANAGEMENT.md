# Bulkimart Service Management implementation

Implemented in the existing Express/Mongoose backend and React admin/seller portals. Admins can define free or fixed-price services, build and preview forms, publish/unpublish services, review applications, request information, reject, process and complete applications with private deliverables. Approved sellers can apply repeatedly, respond with text and/or documents, track history and download their own files. Pricing is recorded only; no checkout, payment verification, refunds or collection flow was added.

## Files

| Area | Created | Modified |
| --- | --- | --- |
| Models | `backend/models/Service.js`, `backend/models/ServiceApplication.js` | `backend/models/Notification.js` (application reference) |
| Backend | `backend/controllers/serviceManagement.controller.js`, `backend/routes/serviceManagement.routes.js`, `backend/services/serviceForms.service.js`, `backend/services/serviceWorkflow.service.js`, `backend/services/serviceStorage.service.js` | `backend/routes/index.js` |
| Frontend | `forntend/src/components/services/ServicesPanel.jsx`, `forntend/src/components/services/services.css` | Admin routes/sidebar; seller dashboard/navigation; `forntend/package.json` |
| Tests | `backend/__tests__/api/service-management.http.test.js`, `forntend/scripts/service-ui.test.mjs` | Root/backend `.gitignore` retain the new API test and exclude local private service data |
| Documentation | `SERVICE_MANAGEMENT.md` | None |

## Data and permissions

`Service` stores a unique slug, publication status, admin attribution, name/description/instructions, price/currency, fields and form version. Major currency units follow existing monetary conventions; prices must have at most two decimal places. Field changes increment the form version. Every service edit increments Mongoose's optimistic version, including price edits; stale applications must reload and review the current definition and price.

`ServiceApplication` stores service, authenticated seller/user references, submission key, immutable service/form/price snapshot, answers, files, status, fulfilment timestamps and events. There is no unique seller/service constraint. A unique seller/submission-key index makes concurrent retries return one application while fresh keys permit repeat applications. The UI locks submissions while they are pending and retains the key for retry.

Application events are embedded rather than a separate `ServiceApplicationEvent` collection. Status, files and events save as a single atomic document with optimistic concurrency. No event-edit/delete or application-delete endpoints exist. Events contain actor, actor type, timestamp, action, status and a limited message; file contents and answers are not copied into audit events. Response text remains in the history and does not overwrite original answers.

Admin APIs require the existing active admin authentication plus `superAdmin` role **or** explicit `manage_services` permission. Other admins/moderators are denied. Vendor APIs require an active authenticated user with the seller role and an approved seller profile, using the existing approval middleware. Seller identity comes from the authenticated user/profile, never request data. Every application/file request applies ownership or admin permission checks.

## APIs

All responses use the existing `{ success, data, meta, message }` envelope. List routes support `page` and `limit` (maximum 100). Application lists support `status`, `service`, `from` and `to` filters. IDs, status values, versions, schema, answers, price and uploads are validated server-side.

Vendor base: `/api/services`

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/` | Published catalogue |
| GET | `/:id` | Published service definition |
| POST | `/:id/applications` | Submit multipart `answers` JSON, `formVersion`, `serviceVersion`, file fields named by field IDs; required `Idempotency-Key` header |
| GET | `/applications` | Own applications |
| GET | `/applications/:id` | Own details and history |
| POST | `/applications/:id/respond` | Multipart `version`, `message` and optional `files`; return to review |
| GET | `/applications/:id/files/:fileId` | Authorized attachment download |

Admin base: `/api/admin/services`

| Method | Path | Behavior |
| --- | --- | --- |
| GET / POST | `/` | List/create services |
| GET / PUT | `/:id` | Inspect/update service; updates require `version` |
| POST | `/:id/publication` | `status` = published/unpublished plus `version` |
| GET | `/applications` | Filtered applications |
| GET | `/applications/:id` | Details/history |
| POST | `/applications/:id/transition` | Multipart `status`, `version`, `message`, optional `files` when completing |
| GET | `/applications/:id/files/:fileId` | Authorized attachment download |

Lifecycle: submitted → under_review → information_required → under_review → in_progress → completed. Admins can reject any nonterminal state with a required reason. Information requests require a message. Only vendors responding to an information request can use the vendor transition endpoint. Completed/rejected applications cannot be reopened, edited or have files replaced. Cancellation has no approved policy and is not implemented.

Dynamic fields support text, multiline text, number, date, select, radio, checkbox, email, phone and file. File fields also define required documents, permitted formats and size limits. Schema validation rejects duplicate/unsafe IDs, unsupported types/options, inappropriate constraints and invalid price/currency. Historical applications always use their own saved schema and price.

## Atomicity and notifications

Submission makes a conditional write against the published service and exact version. That write is the acceptance boundary relative to concurrent service changes/unpublication. Replica sets commit service acceptance and application creation in a transaction. Standalone MongoDB uses the repository's unsupported-transaction fallback pattern: the conditional acceptance write precedes application creation. The service's diagnostic `submissionCount` can overcount failed or concurrent retry attempts on standalone MongoDB; it must not be used for billing or application totals. Application totals come from application records.

An application accepted before unpublication may finish its in-flight submission afterward; submissions that reach acceptance after unpublication are denied. Unpublication preserves existing applications and private file access.

Status changes, vendor responses, file references and events are atomic within an application document. Files are written before committing references. Failed operations clean up unreferenced files; cleanup first checks database references so an acknowledgement failure cannot delete a committed file. If the database cannot confirm references, cleanup retains files for reconciliation. A process/power failure can leave unreferenced files or `.partial` files; no automatic destructive retention job was introduced.

Existing `SYSTEM` notifications are emitted after successful database writes: submission/vendor responses notify admins; admin changes notify the vendor. Existing notification persistence, sockets and push behavior are reused. Delivery is best effort, with no new external platform or transactional notification outbox. Existing admin notification fan-out includes all active admins; opening an application still requires `manage_services`/superAdmin authorization. Notification content contains only application ID/status, not submitted answers or documents.

## Private storage and deployment prerequisites

The new setting is **`SERVICE_STORAGE_DIR`**, an absolute path to durable private storage. Production/production deployment environments reject uploads unless it is configured. Development defaults to ignored `backend/private-data/services`.

Each stored file has a generated UUID filename and checksum. Original names are sanitized for display only. Public frontend/build directories are rejected, including resolved storage symlinks. Downloads reject symlink files, verify size/checksum and return attachments with private/no-store caching, nosniff and sandbox headers. No public Cloudinary assets, static file routes or permanent download URLs are created. The UI fetches attachments with bearer authentication and uses temporary browser object URLs for downloads.

PDF validation reuses the existing e-book validator (extension, MIME, header, EOF). PNG/JPEG validation checks extensions, declared MIME and signatures. These checks are not antivirus scanning or full image/PDF parsing. Service limits are 5 MiB per file, 10 files per request, 10 configured file fields and 100 files per application. Field-specific limits may be lower. The shared answer, multipart and resource limits are specified below. Uploads use bounded memory buffers and never write public temporary files. On POSIX, new directories/files use modes 0700/0600; administrators must apply equivalent ACLs on Windows and secure any pre-existing parent directories.

The repository's `deploy.sh` uses a PM2 process and checkout update. It does **not** establish a persistent private volume, backups, ACLs or multi-instance shared storage. Deployment persistence has **not** been verified. This feature is not declared production-ready.

Before rollout:

1. Provision durable private storage outside the checkout and web document roots, for example `/var/lib/bulkimart/services`. Set `SERVICE_STORAGE_DIR` for the backend runtime. Do not expose the directory through Nginx, static hosting or Cloudinary. All backend replicas must share the same private filesystem, or a separate private object-storage adapter is needed before horizontal scaling.
2. Grant only the backend service account and authorized backup operators access. Verify volume persistence through a real restart/redeploy and test restore of MongoDB **and** files together. Define retention, encryption at rest and incident handling according to the actual hosting setup.
3. Let the existing model/index initialization create the new collections/indexes, or create equivalent indexes during the approved deployment process if production disables automatic indexing. In particular verify unique `(vendor, submissionKey)` and service slug indexes before accepting submissions. No existing-data migration is required.
4. Grant `manage_services` only to authorized existing admins; superAdmins already qualify. No credentials or production accounts were changed locally.
5. Run the tests/builds below. In staging, exercise real admin/vendor login, notifications, repeat applications, information responses and private downloads across two vendor accounts. Verify unauthenticated/other-vendor denial through the actual proxy.
6. Reconcile old orphan files conservatively: compare UUID filenames against all application file references, allow an age/grace window longer than any in-flight upload, recheck references immediately before deletion and retain uncertain files. Investigate `.partial` files left by crashes. No cleanup script or production deletion was executed.

## Verification performed locally

| Command / scope | Result |
| --- | --- |
| Baseline auth + existing e-book storage suites | 2 suites, 22 passed, 0 failed |
| `cd backend; npm test -- --runInBand` | 46 suites passed; 316 tests passed, 7 skipped, 0 failed (323 total) |
| `cd backend; npm test -- --runInBand __tests__/api/service-management.http.test.js` | 33 passed, 0 failed, included in full-suite totals |
| `$env:SERVICE_TEST_REPLICA='1'; npm test -- --runInBand __tests__/api/service-management.http.test.js` | 33 passed, 0 failed against an isolated replica set |
| `cd forntend; npm run test:services` | 16 passed, 0 failed |
| `cd backend; npm run build` | Passed (`node --check index.js`) |
| `cd forntend; npm run build` | Passed; Vite warns about chunks larger than 500 kB (main bundle about 1.68 MB minified) |
| `git diff --check` | Passed |

The API suite uses genuine Express routing/JWT middleware and real isolated MongoDB/application models, with fixture user/admin/seller lookups and notification delivery mocked. It covers publication, permissions, vendor approval, repeat submissions, concurrent retries/status edits, snapshots, ownership, private downloads, workflow/reasons/responses/deliverables, malformed forms, oversized/invalid uploads and storage configuration. Both standalone fallback and replica-set transactions were exercised.

Frontend tests render the actual React components using Vite SSR and Node's built-in test runner, plus a controlled hook/effect harness for asynchronous component interactions. They check fields/constraints, errors, loading states, editor controls, escaped answers, private download controls, busy actions, terminal states and the regressions below. The hook harness deliberately lets aborted requests resolve to verify generation guards. These are **not** DOM/browser interaction tests. No browser automation tools were available in the session. No browser-driven or deployed end-to-end session, live notification delivery, production storage persistence/ACL verification or backup/restore test was performed. Neither package defines a lint script. No failing pre-existing tests were observed; the seven skipped backend tests were not executed.

No deployment, production database writes, destructive migrations, payment changes or unrelated marketplace refactors were performed.

## Focused audit fixes — 2026-10-15

All five actionable audit defects are fixed and locally regression-tested. This does not establish production readiness.

| Defect | Root cause | Fix and regression coverage |
| --- | --- | --- |
| Stale list responses | Catalogue/application requests wrote the same state without request identity | Abort controllers plus generation checks discard obsolete successes, failures and loading updates. Navigation invalidates pending work immediately, clears the previous view's records, and unmount cancels both list/detail scopes. Tests resolve catalogue after applications, switch repeatedly, reject obsolete/current requests and unmount before resolution. |
| Answer/transport mismatch | Valid individual answers could exceed the 128 KiB multipart field cap | Shared UTF-8 serialized aggregate limit and compatible transport limit; identical client/server checks. Tests submit the original 200,291-byte scenario, values immediately below/above the aggregate boundary, individual boundaries, multiline/Unicode data, malformed JSON and oversized multipart fields. |
| Upload resources/late checks | Memory buffering preceded application ownership/state checks; no service upload budget existed | Existing authentication/admin permissions/seller approval run first, then account rate limit and ownership/state preflight, then concurrency acquisition and byte-counted parsing. Controllers recheck ownership/state/version. Tests cover anonymous/unapproved/other sellers, terminal states, size/count limits, account/global concurrency, rate limiting, chunked body limits, parser failures, disconnects, timeouts and capacity/buffer release. |
| Stale open detail | Refresh reloaded only list records; 409 did not provide record recovery | Refresh fetches list and current detail. Successful detail reload updates version/status/history/files/actions. Conflicts present an explicit reload action without automatically retrying a mutation. Draft messages/file selections require confirmation before reload/navigation; rejection preserves the existing component/draft. Detail generation checks reject older responses. |
| Service notification navigation | Admin header only handled ticket metadata | Service notification references are validated and navigate to `/admin/services?application=<opaque ID>`. Only the protected detail API populates the screen. Direct opening/reloading the route works; malformed/missing references fall back safely and 403/404 show a generic unavailable message. Concurrent clicks/read updates are deduplicated. Ticket behavior is retained. Tests cover valid service/ticket notifications, malformed/missing references, direct routes and inaccessible details. |

### Exact limits and rationale

`shared/serviceLimits.mjs` is the browser/backend source of truth. The explicit `.mjs` extension avoids relying on Node's automatic module detection outside the backend package.

| Limit | Value | Rationale |
| --- | --- | --- |
| Individual text/multiline answer | At most 10,000 UTF-16 code units, or a lower configured maximum | Matches JavaScript string length and browser maxlength behavior; schema configurations above this are rejected. |
| Serialized answers | At most 262,144 UTF-8 bytes (256 KiB) | Includes JSON keys, quotes, escapes, delimiters and multibyte characters. Accommodates twenty 10,000-character ASCII answers (200,291 bytes) while imposing an explicit combined budget; a form's answers must meet both individual and aggregate limits. Raw JSON input and parsed/serialized answers are both checked. |
| Any multipart text field | 263,168 bytes (257 KiB) | Small parser headroom ensures application-level 256 KiB validation handles boundary cases instead of truncating them. Larger transport violations receive a normalized 413 response. |
| Files | Ten, each at most 5,242,880 bytes (5 MiB) | Preserves the original file limits; service document fields can impose lower limits. |
| Entire request body | 52,756,480 bytes (50 MiB + 256 KiB answers + 64 KiB overhead) | Fits all ten full-size files plus valid answers and bounded multipart metadata. Content-Length is checked early; a streaming byte counter also handles chunked requests. |
| Multipart shape | Ten text fields, twenty total parts, field names at most 100 bytes | Bounds metadata/part proliferation. |
| Account rate | Thirty submission/response/transition requests per fifteen minutes | Uses existing express-rate-limit conventions and authenticated account/type keys; includes failed attempts. All service upload/transition endpoints share the budget. |
| Concurrency | Four operations per backend process, at most two per account | Slots cover parsing through controller/storage completion, including requests without files. Rejections return 429; uploads are not queued in memory. Payload buffers can total roughly 200 MiB across four maximum-size requests, plus parsing/copy/framework overhead. Validate these budgets against real host memory before rollout. |
| Upload parsing timeout | Sixty seconds | Interrupted, malformed and timed-out streams release their slot and buffers. No disk staging is introduced. |

These controls are service-specific; unrelated upload/parsing limits and authentication middleware were not changed. Preliminary ownership checks deliberately return the same 404 for nonexistent and other-seller applications. Closed applications return 409 before multipart parsing. Application-level size errors return a helpful 413; malformed JSON/multipart receives 400. Buffer references are released in a finally block, and failures after private writes retain the existing conservative reference-aware file cleanup. Disconnection after a successful database commit preserves that application's referenced files.

### Files changed by the focused fixes

| Exact path | Purpose |
| --- | --- |
| `shared/serviceLimits.mjs` | New shared byte/character/file limits and UTF-8 serialized-size helper |
| `backend/services/serviceForms.service.js` | Individual and aggregate answer validation |
| `backend/services/serviceStorage.service.js` | Reuse the shared existing per-file limit |
| `backend/controllers/serviceManagement.controller.js` | Raw JSON byte checks, early ownership/state preflight and interrupted-write checks |
| `backend/middlewares/serviceUpload.middleware.js` | New account rate limiter, concurrency budget, bounded multipart stream, timeout/error normalization and buffer cleanup |
| `backend/routes/serviceManagement.routes.js` | Order authentication, rate/preflight and guarded uploads without removing controller checks |
| `backend/__tests__/api/service-management.http.test.js` | Eleven additional regression tests (33 total), including the complete 72-case lifecycle matrix |
| `forntend/src/components/services/ServicesPanel.jsx` | List/detail request scopes, current-record refresh, conflict/draft recovery, deep links and client payload validation |
| `forntend/src/components/services/serviceRequests.js` | New cancellable generation scopes and reference validation |
| `forntend/src/modules/Admin/components/TopHeader.jsx` | Wire service notification navigation while retaining ticket handling |
| `forntend/src/modules/Admin/utils/serviceNotifications.js` | New validated, deduplicated notification opener |
| `forntend/scripts/service-hookHarness.mjs` | New deterministic actual-component hook/effect interaction harness |
| `forntend/scripts/service-ui.test.mjs` | Ten additional frontend regression tests (16 total) |
| `SERVICE_MANAGEMENT.md` | Updated limits, verification, file inventory and remaining risks |

The complete backend suite includes the existing e-book storage, auth and unrelated marketplace suites. All 46 suites passed. Initial expanded regression runs exposed incorrect upload error normalization and a traversal bug in the new test harness; these were corrected and the relevant tests rerun successfully. No current failures remain.

### Remaining risks and worktree/deployment status

Rate and concurrency budgets are per process, using the same in-memory limiter infrastructure as the existing app. Restarts reset rate budgets, and multiple processes each have their own budget. Distributed limits and real proxy behavior remain unverified. No malware scanner, durable notification outbox, production storage changes or orphan-deletion automation was added by these fixes. Storage persistence, ACLs, shared-volume behavior, backup recovery and live notification delivery still require independent verification.

The initial dirty worktree was inspected before editing. Existing ignore rules, models, route registration, package script and admin/seller navigation changes were preserved. No reset, checkout, cleanup, reformat, commit or deployment was performed. Most service feature files were already untracked at the start, so plain `git diff --stat` does not include their contents; the exact focused file inventory above includes those files. Production data and business policies for pricing, payments, refunds and cancellation were not changed.
