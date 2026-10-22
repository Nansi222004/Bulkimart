# Bulkimart Legal Services — Customer Integration Audit

Audit date: 22 October 2026. Scope: static analysis of the current working tree at `D:\Appzeto_Projects\Bulkimart1`. Analysis and planning only.

## 1. Executive summary

The repository does **not establish a vendor-operated Legal Services marketplace**. The verified implementation is an **admin-managed service catalogue for approved vendors to apply to**. Admins create forms and publish services; vendors submit applications, receive information requests, track processing, and download private deliverables. This distinction changes the integration plan: a vendor application is not a customer booking, and the vendor on an application is the applicant, not the service provider.

No separate legal-service model, legal-service category, customer legal-service page, provider listing, appointment system, or legal-service payment flow was found in the inspected source. Legal offerings may exist as runtime `Service` records, but their names, definitions, prices, intended audience, and existence in the database are **unknown** because no database was accessed. Seller onboarding “legal documents” are KYC data, not service listings.

The shared service implementation is useful infrastructure: publication checks, dynamic forms, price/form snapshots, idempotent submissions, administrative processing, private documents, and notifications exist. All non-admin service endpoints require an approved seller. Ordinary customers cannot use them. Fixed-price services record the price only; they do not charge it. `SERVICE_MANAGEMENT.md` explicitly confirms this, and the controller has no payment calls.

Recommended first release, subject to business approval: a dedicated customer Legal Services catalogue, reached through a homepage discovery card and an account “My service requests” link. Extend the existing `Service` and `ServiceApplication` models with explicit audience and applicant semantics, and use admin processing initially. Offer **Submit request**, with clear payment wording, rather than “Buy” or “Book”. Add service categories/search only with explicit catalogue metadata; do not reuse product checkout or infer a legal category from a service name. A provider marketplace, appointments, quotes, and payments are later, separately approved capabilities.

Highest-priority issues before exposure: no customer ownership policy; no customer-safe service response projection; an admin permission discrepancy; no legal-service audience classification; and no service payment/cancellation contract. Private file infrastructure is substantially safer for legal documents than the existing support-ticket attachment path.

## 2. Investigation method and limitations

- The session’s available tool catalogue was searched for code-review-graph tools before code exploration. None were available. Graph searches, impact radius, affected flows, and `tests_for` queries could not be executed; targeted `rg` and source reads were the fallback.
- Inspected source, local tests, package scripts, and `SERVICE_MANAGEMENT.md`. Only the root `AGENTS.md` was found by the instruction-file search.
- This is a working-tree audit, including existing uncommitted finance/checkout changes. It does not describe only committed HEAD. Those changes were left intact.
- No server, browser, test suite, build, seed, migration, database connection, index operation, payment, or deployment was run. Even isolated database tests were not run because this task prohibits creating/modifying database records and indexes.
- Live catalogue contents, admin grants, deployed indexes, storage persistence/ACLs, production routing, credentials, payment configuration, and actual notifications are unknown. Source validation does not establish production readiness.
- Existing test assertions and prior verification claims in documentation are evidence of intended coverage, **not fresh passing results**. Some tests are local-only/ignored; `tests/README.md` warns they may be absent from a fresh clone. Its relocation note explains why older documentation references `forntend/scripts/service-ui.test.mjs`, while the current path is `forntend/tests/service-ui.test.mjs`.
- No external legal, compliance, professional-credential, or payment-provider policy determination was attempted. Proposed privacy and transaction controls below are engineering recommendations, not legal advice.

## 3. Existing vendor-side workflow

### 3.1 Entry points and actual actors

| Exact path | Verified purpose / functions |
| --- | --- |
| `forntend/src/modules/Seller/components/LeftNav.jsx` | “Services” navigation item |
| `forntend/src/modules/Seller/pages/DashboardPage.jsx` | Maps `/seller/services` to `services`; renders `<ServicesPanel />` |
| `forntend/src/modules/Admin/components/LeftSidebar.jsx` | “Vendor Services” admin navigation |
| `forntend/src/modules/Admin/routes/index.jsx` | Renders `<ServicesPanel admin />` for services |
| `forntend/src/components/services/ServicesPanel.jsx` | `ServicesPanel`, `ServiceEditor`, `DynamicFields`, `ApplicationDetail`; catalogue, form editor/preview, applications, processing and downloads |
| `forntend/src/components/services/serviceRequests.js` | `createLatestRequest` abort/generation guards; `serviceApplicationId` identifier check |
| `forntend/src/components/services/services.css` | Shared responsive cards, grid, forms, errors, focus styles |
| `forntend/src/modules/Admin/utils/serviceNotifications.js` | Admin service-application notification opening and validated references |
| `SERVICE_MANAGEMENT.md` | Existing design, contracts, limitations, historical verification |

The vendor UI says “Service catalogue”, “My applications”, and “View requirements and apply”. **Only admin mode exposes “Create service”, editing/preview, and publish/unpublish.** No vendor service creation, price setting, activation toggle, deletion route, or provider fulfilment dashboard was found. There is no deletion endpoint for services or applications, and no independent service `isActive` flag.

### 3.2 Definition and publication

`ServiceEditor` collects name, slug, description, instructions, free/fixed price, currency, and dynamic fields. Admin `saveService` validates and creates a draft; updates require the exact `version` (`__v`). `formVersion` increments when the field definition changes. `publishService` validates the definition again and sets `published` or `unpublished`; it records the publishing time and admin identity. Saving a published service edits it in place: no separate revision-approval stage or automatic return to draft is implemented.

The editor supports text, textarea, number, date, select, radio, checkbox, email, phone, and file fields, with ordering, labels, help, required flags, options, applicable numeric/length constraints, file formats and file-size limits. A file field collects an **applicant document**; it is not a public listing image or brochure.

There are no first-class legal categories, provider credentials, provider references, coverage regions, pincode eligibility, appointment slots, service images, public attachments, terms versions, or turnaround times. Description/instructions can carry admin-authored prose, but do not enforce any of those structured capabilities.

### 3.3 Application lifecycle

1. `protect` verifies the token and live active account. The service router requires a user with seller membership and `requireApprovedSeller` resolves an approved seller profile.
2. Vendor list/detail queries return only published definitions. The vendor chooses a service and completes its dynamic form.
3. `submitApplication` requires multipart `answers` JSON, `formVersion`, `serviceVersion`, optional document fields, and an `Idempotency-Key` matching `[a-zA-Z0-9-]{16,100}`.
4. Server checks publication, exact form/service versions, answers, and files. It privately stores files and captures a snapshot of name, instructions, form version, fields, and pricing.
5. `createApplication` conditionally updates the exact published service version. Replica-set transactions combine this acceptance and application insertion. A standalone fallback accepts before insertion; its diagnostic `submissionCount` may overcount failed/concurrent attempts.
6. Application starts `submitted`; admins receive a generic application update notification. Existing same-vendor/same-key submissions replay the original application; a new key intentionally permits another application.
7. Admin workflow: `submitted → under_review → in_progress → completed`, with an optional `under_review → information_required → under_review` loop. Admins can reject any nonterminal state. Reasons are required for information requests and rejection.
8. Vendors can respond only while information is required, with text and/or documents. They cannot choose arbitrary processing states. Admin completion can attach deliverables. Closed applications cannot accept further transitions/uploads.
9. Vendors see history/status and can download their own documents/deliverables. Admin updates notify the applicant’s `User` identity. Unpublishing does not erase accepted applications or their private access.

`transition` in `backend/services/serviceWorkflow.service.js` centralizes allowed transitions. Application `__v` checks and optimistic concurrency reject competing edits with 409. There is no cancellation, reopening, quote acceptance, appointment confirmation, general chat, or payment state in this lifecycle.

**Customer lifecycle boundary:** no ordinary customer can reach step 2 through the present service API. Nothing in this lifecycle creates a purchasable product, cart item, service order, or appointment.

## 4. Backend inventory and current API contracts

### 4.1 Exact files and responsibilities

| Exact path | Responsibility |
| --- | --- |
| `backend/models/Service.js` | Admin-owned catalogue definition, publication, pricing, form version, counters |
| `backend/models/ServiceApplication.js` | Vendor applicant, user identity, snapshot/answers, private files, status/events, unique submission key |
| `backend/routes/index.js` | Mounts `/api/services` and `/api/admin/services` via the main `/api` mount in `backend/index.js` |
| `backend/routes/serviceManagement.routes.js` | `serviceRouter`, `serviceAdminPermission`, authentication, seller/admin gates and upload preflight |
| `backend/controllers/serviceManagement.controller.js` | `listServices`, `getService`, `saveService`, `publishService`, `submitApplication`, `listApplications`, `getApplication`, `preflightApplicationUpload`, `actOnApplication`, `downloadFile`; internal `ownedApplication`, `createApplication`, `publicApplication`, `notify` |
| `backend/services/serviceForms.service.js` | `validateDefinition`, `validateAnswers`, `text`, `fail`; rejects unknown/unsafe form keys and invalid constraints |
| `backend/services/serviceWorkflow.service.js` | `TRANSITIONS`, `transition` |
| `backend/services/serviceStorage.service.js` | `storageRoot`, `validateServiceFile`, `storeServiceFiles`, `removeServiceFiles`, `readServiceFile` |
| `backend/middlewares/serviceUpload.middleware.js` | `createServiceUploadControls`, shared `serviceUploadControls`: multipart parsing, byte/rate/concurrency limits |
| `backend/shared/serviceLimits.mjs` and `shared/serviceLimits.mjs` | Canonical limits and frontend re-export |
| `backend/middlewares/auth.middleware.js` | `protect`, `requireAdmin`, available `requireCustomerSession` and `requireSellerSession` helpers |
| `backend/middlewares/vendor.middleware.js` | `requireApprovedSeller`: resolves `req.seller`; blocks nonapproved profiles |
| `backend/middlewares/error.middleware.js` | Normalized errors, duplicate-key 409, development-only stack exposure |
| `backend/models/Notification.js`, `backend/services/notification.service.js` | Application reference metadata; persistence, best-effort sockets/push and admin fan-out |
| `backend/scripts/checkServicePackage.mjs` | Temporary backend-only package import verification; not a service data seeder |

### 4.2 Existing endpoints

All `/api/services` routes below require an active user with seller membership and an approved seller profile; they are **not public or customer endpoints**. Admin routes require active admin authentication and the permission logic discussed in section 6.

| Method and path | Input / query | Output / behavior |
| --- | --- | --- |
| `GET /api/services` | `page`, `limit` | Published service documents; pagination metadata |
| `GET /api/services/:id` | ObjectId | Published service document, or 404 |
| `POST /api/services/:id/applications` | Multipart versions, JSON answers, field-ID file parts; idempotency header | 201 new application; 200 replay |
| `GET /api/services/applications` | `page`, `limit`, `status`, `service`, `from`, `to` | Own vendor applications, summary projection |
| `GET /api/services/applications/:id` | Application ObjectId | Own full application, excluding file hashes |
| `POST /api/services/applications/:id/respond` | Multipart `version`, `message`, optional `files` | Updated own application; only information-required response |
| `GET /api/services/applications/:id/files/:fileId` | Application and file IDs | Authenticated attachment bytes |
| `GET /api/admin/services` | `page`, `limit` | All definitions, including draft/unpublished |
| `POST /api/admin/services` | JSON validated definition | 201 draft definition |
| `GET /api/admin/services/:id` | ObjectId | Full definition |
| `PUT /api/admin/services/:id` | JSON definition plus `version` | Saved definition; stale version 409 |
| `POST /api/admin/services/:id/publication` | `status: published|unpublished`, `version` | Publication update |
| `GET /api/admin/services/applications` | Same list filters as vendor | All matching application summaries |
| `GET /api/admin/services/applications/:id` | Application ObjectId | Full application excluding hashes |
| `POST /api/admin/services/applications/:id/transition` | Multipart `status`, `version`, `message`, optional completion `files` | Updated application |
| `GET /api/admin/services/applications/:id/files/:fileId` | IDs | Authorized attachment bytes |

Application routes are registered before `/:id`. Pagination defaults to page 1/limit 20; limit is 1–100 and page 1–100,000. Definitions have no text search, category, price, coverage, audience, or provider filters. Application date filters use day strings and an exclusive next-day upper bound.

`send` returns `{ success: true, data, meta }`; success does not always include `message`. Lists use `meta: { total, page, limit }`. Application list projection is `snapshot.name snapshot.pricing status createdAt vendor service` plus implicit `_id`. Application details serialize all fields except `files[].sha256`; service responses serialize full documents. Validation errors use `{ success: false, data: null, message, meta }`, with field errors at `meta.fields`. Typical statuses: 400 invalid input, 401 unauthenticated, 403 forbidden, 404 unavailable/ownership mismatch, 409 stale/conflicting state, 413 oversized, 429 upload limits, 503 storage failure. Do not treat a serialized Mongoose document as an approved public contract.

## 5. Data dictionary and compatibility

**Customer availability for every field below is currently “none”: no customer-facing service response exists.** “Current exposure” describes the protected vendor/admin API, not a public API. Requiredness distinguishes schema rules from controller validation.

### 5.1 Every existing `Service` field

| Database field / type | Required/default | Created or updated by | Current exposure / privacy and proposed visibility |
| --- | --- | --- | --- |
| `_id` / ObjectId | Automatic | Mongoose create | Full definition responses; usable opaque service reference, never authorization |
| `name` / String | Schema and API required; max 150 | Admin `saveService` | Vendor/admin; suitable public display after audience/publication checks |
| `slug` / String | Schema/API required; unique; max 100, lowercase hyphenated | Admin `saveService` | Vendor/admin; public identifier candidate; existing GET resolves ObjectId, not slug |
| `description` / String | Schema optional; API required, max 10,000 | Admin `saveService` | Vendor/admin; review for customer audience before exposure |
| `instructions` / String | Optional, normalized to empty, max 10,000 | Admin `saveService` | Vendor/admin; may contain vendor-only instructions, review before public use |
| `status` / String | draft/published/unpublished; default draft | Create, admin `publishService` | Vendor only sees published; return only necessary availability semantics publicly |
| `pricing.mode` / String | Schema optional; API requires free/fixed | Admin `saveService` | Vendor/admin; public display candidate, not evidence of collection |
| `pricing.amount` / Number | API required, finite, 0–10,000,000, max 2 decimals; free=0, fixed>0 | Admin `saveService` | Major units; safe display only with approved charging explanation |
| `pricing.currency` / String | API requires supported uppercase 3-letter currency | Admin `saveService` | Public display candidate; Razorpay helper currently uses INR only |
| `fields` / Mixed[] | API requires array, max 50 | Admin `saveService` | Entire form exposed to approved vendors; only customer-approved definitions should be published to customers |
| `formVersion` / Number | Default 1 | Create; field changes increment in `saveService` | Concurrency/form compatibility token needed at submission |
| `submissionCount` / Number | Default 0 | `createApplication` conditional acceptance increments | Internal diagnostic; omit from public response, not reliable billing or total count |
| `createdBy` / ObjectId → Admin | Optional in schema, set by controller | Admin creation | Internal admin identity; omit publicly |
| `updatedBy` / ObjectId → Admin | Optional in schema, set by controller | Admin create/edit/publication | Internal admin identity; omit publicly |
| `publishedAt` / Date | Optional | Each publish sets now; unpublish does not clear | Protected responses; public only if product requirement justifies |
| `createdAt`, `updatedAt` / Date | Automatic timestamps | Mongoose writes | Public optional metadata, not an approval policy |
| `__v` / Number | Mongoose version | Optimistic saves | Existing client submits as `serviceVersion`; expose an explicit version token if needed rather than internal attribution |

Each `fields[]` definition has: required `id` (safe, unique identifier), `type` (10 supported types), `label` (max 150), boolean `required`; optional `help` (max 500, normalized empty). Select/radio require 1–50 unique `options` strings (max 150 each). Number fields may have finite `min`/`max`; text/textarea/email/phone may have integer `minLength`/`maxLength` up to 10,000. File fields have `formats` (default pdf/png/jpg, nonempty allowed subset) and `maxBytes` (default 5 MiB, at most 5 MiB). At most 10 file fields are allowed. Admin creates/updates these through the same validator. They configure collection, not actual customer/provider data. Public pre-login exposure of full intake schemas is a business/privacy choice; catalogue cards do not need them.

Absent definition fields: legal classification/category, customer/vendor audience, provider, credentials verification, coverage, service-specific availability, booking capacity, quote mode, hourly rate, consultation fee designation, listing images/public documents, structured terms or cancellation rules. These cannot be recovered reliably from prose or application answers.

### 5.2 Every existing `ServiceApplication` field

| Database field / type | Required/default | Created or updated by | Current exposure / sensitivity |
| --- | --- | --- | --- |
| `_id` / ObjectId | Automatic | Create | Own vendor/admin reference; not proof of access |
| `service` / ObjectId → Service | Required/indexed | `submitApplication`, server derived | Own/admin list and details |
| `vendor` / ObjectId → Seller | Required/indexed | Authenticated applicant seller, server derived | Own/admin; **applicant**, not provider |
| `user` / ObjectId → User | Required | Authenticated applicant user | Full detail; private owner identity |
| `submissionKey` / String | Required; unique with vendor | Header validated on submission | Full detail; internal retry key, omit from customer response |
| `snapshot` / Mixed | Required | Submission copies service name/instructions/formVersion/fields/pricing | Historical contract/form; sensitive once combined with answers; no description/terms/provider snapshot today |
| `answers` / Mixed | Required | Initial validated multipart JSON | Full detail only; potentially highly sensitive; no original-answer edit route |
| `status` / String | Default submitted; six-state enum | Submit/`actOnApplication` | Own/admin list/detail; suitable owner-only tracking |
| `files` / embedded array | No schema required flag | Submission, vendor response, admin completion | Metadata in own/admin details; content only via authorized download |
| `events` / embedded array | No schema required flag | Submission and `transition`, file additions | Full detail; may contain private response text/admin IDs |
| `informationRequest` / String | Optional | Admin information-required transition | Owner/admin; may contain sensitive context |
| `rejectionReason` / String | Optional | Admin rejection; required by transition | Owner/admin; not public |
| `processingAt` / Date | Optional | in-progress transition | Owner/admin status metadata |
| `completedAt` / Date | Optional | completed transition | Owner/admin status metadata |
| `processedBy` / ObjectId → Admin | Optional | Admin transitions | Internal operator identity; omit from customer projection |
| `createdAt`, `updatedAt` / Date | Automatic | Mongoose | Owner tracking, admin filtering |
| `__v` / Number | Automatic version | Optimistic saves | Required as `version` for updates; map to deliberate API token |

Embedded `files[]` fields are `fileId`, `name`, `format`, `sizeBytes`, `sha256`, `fieldname`, `kind` (document/response/deliverable), and `uploadedAt`. No individual schema `required` flags are set; storage creates validated metadata. All except `sha256` appear in detail responses; hashes remain server-side. Filenames and field names can themselves be sensitive. No content or storage path is returned in JSON.

Embedded `events[]` have automatic `_id`, required `action`, `actor` ObjectId, required `actorType` (admin/vendor), optional `status`, `message`, and default `at`. They are appended at submission, transitions and file additions, not edited/deleted through an endpoint. Actor IDs are internal; actor labels and approved messages are sufficient for customers. Messages are max 2,000 characters under workflow validation. A customer actor is not supported by the current enum.

Indexes declared in source: unique service slug; service status; application service/vendor/status; unique `(vendor, submissionKey)`; application `(createdAt desc, _id desc)`. Deployment/index existence was not inspected.

### 5.3 Can the existing models be reused?

Yes for an **admin-fulfilled customer request**, with explicit changes; no schema duplication is needed merely to add another applicant audience. They cannot accept a buyer unchanged: `vendor` is required, ownership always uses `req.seller`, uniqueness is vendor-scoped, and event actors exclude customers.

Recommended extension design, not implemented:

- `Service`: explicit legal classification and audience (`vendor`, `customer`, or an approved equivalent), defaulting legacy services to vendor-only. Customer visibility requires published status **and** customer eligibility. Do not globally expose all currently published vendor services.
- `ServiceApplication`: explicit applicant type; authenticated `user` remains owner; `vendor` becomes conditionally required for vendor applicants. Keep legacy vendor applications and semantics. Separate applicant identity from any future `provider` assignment.
- Customer uniqueness scoped to authenticated owner/applicant type plus submission key. Existing vendor index compatibility and any partial indexes require an approved future index plan; do not simply make `vendor` optional under the old uniqueness assumption. Reusing a key across different intents should return 409. Bind keys to a canonical request fingerprint if payload consistency is required; current replay checks only service ID, not answers/files/version equality.
- Extend event actor types and ownership helpers without granting buyers vendor privileges. Add customer-specific list/detail projections and intake policies; admin lists need an applicant-type filter and customer identity rendering instead of a mandatory “Vendor ID”.
- Snapshot any newly approved customer terms/coverage/price description needed to interpret historical requests; do not add unnecessary personal data to snapshots or events.

If business requires independent provider listings, assigned professionals, quotes, or slot reservations, that is a larger domain extension. `ServiceApplication.vendor` must never be repurposed into provider ownership. A distinct booking/quote entity may then be justified, but not a duplicate of this simple request record without a defined lifecycle.

## 6. Admin approval, visibility and security findings

| Finding | Evidence and current behavior | Required action before customer rollout |
| --- | --- | --- |
| Customer access missing | `serviceRouter(false)` requires seller membership and approved seller; buyer tests assert 403 | Dedicated public read/customer request routes, explicit customer session and ownership policy; do not remove seller gates globally |
| No customer audience boundary | `listServices`/`getService` filter only publication for non-admins | Add audience/legal eligibility and apply consistently to list, detail, and acceptance |
| Admin permission mismatch | `serviceAdminPermission` permits roles **superAdmin OR admin**, or explicit `manage_services`; `SERVICE_MANAGEMENT.md` describes superAdmin OR explicit permission | Decide intended policy and test an ordinary `role: admin` without permission; current fixture does not establish denial for that case |
| Overbroad service DTO for public use | Definition queries return full Mongoose documents including createdBy, updatedBy, submissionCount, __v | Add explicit allowlists; never expose raw service/application documents publicly |
| Vendor portal session distinction | Service router checks membership but does not invoke existing `requireSellerSession` | A buyer-context token belonging to a dual-role approved seller may meet this gate; decide and test portal separation rather than claiming seller-token enforcement exists |
| Applicant isolation currently good but vendor-specific | `ownedApplication` queries exact vendor; unauthorized and missing application return 404; file route uses same lookup | Preserve this for vendors; add owner/type predicates for every customer list/detail/respond/download and future provider route |
| Sensitive service uploads use private storage | Private UUID files, checksum/size verification, symlink-file rejection, authenticated attachment download | Reuse controls; verify durable private deployment storage, Windows ACLs, encryption/backup/retention and restore outside this audit |
| Content validation has limits | PDF validator reuse, MIME/extension and PNG/JPEG signatures; bounded buffers | No antivirus/content-disarm/full parser established; evaluate scanning/quarantine for sensitive intake, keep attachment-only responses |
| Storage safety is partly operational | `storageRoot` rejects frontend public/dist locations and requires production configuration, but cannot know every externally configured web root | Verify directory is outside all actual static roots and shared across replicas; do not claim configuration alone proves privacy |
| No document retention lifecycle | Reference-aware failure cleanup exists; crashes can leave orphans/partials; no application delete/retention job | Approve minimal retention, owner access after closure, legal hold/deletion handling and conservative reconciliation |
| Upload limits are per process | 30 operations/account/15 min; 4 concurrent total, 2/account; 60-second parser timeout | Reassess for customer traffic; distributed budgets if scaled; catalogue reads need their own abuse strategy |
| Duplicate retry protection is not duplicate-intent prevention | Unique vendor/key and frontend busy lock; new keys allow repeat applications; key not persisted across reload | Customer stable pending key, server unique scope, replay recovery and payload-binding policy; do not prohibit legitimate repeat services accidentally |
| State races handled at acceptance | Conditional published/version write; snapshot and optimistic application saves | Preserve checks and add audience/availability/provider eligibility if introduced; treat accepted requests separately from future catalogue availability |
| Counter not financially authoritative | Standalone fallback increments before application insertion | Use application records, never `submissionCount`, for charging, quotas or reliable totals |
| Broad admin notification fan-out | `notifyAllAdmins` called for application submissions/responses | Permission-scope recipients if appropriate; content currently only application ID/action, never include legal answers/documents in push |
| Notifications not transactional | Post-write best-effort notification service, no service-specific outbox | Confirmation/status must come from saved record, not assumed notification delivery |
| Support uploads unsuitable as confidential intake | `ticket.controller.js::uploadAttachments` uses Cloudinary `uploadFileWithMeta`, stores returned URLs; ticket has no service-application relationship | Do not route legal documents through ticket attachments without a separate privacy review/private delivery design |

There is no public draft/inactive service leak through the current service router: authenticated vendor queries explicitly require `published`, and unauthenticated callers fail authentication. This is not proof that an unimplemented public endpoint would be safe. “Active service” and provider activity rules do not exist here. Account inactivity is enforced by `protect`; seller approval (including suspension denial) is enforced for the applicant by `requireApprovedSeller`. There is no service provider whose approval/activity can currently be evaluated.

Uploads accept up to 10 files of 5 MiB each, at most 100 accumulated application files, and 256 KiB serialized answers with 10,000-character individual text limits. Request-size, multipart shape, timeout and concurrency controls are verified in `serviceUpload.middleware.js`. Response/transition preflight checks ownership and terminal state before buffering; controllers recheck ownership/state/version. Service submission validates its definition after parsing, but authentication/approval and shared resource limits precede parsing.

Downloads set `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, sandbox CSP, attachment disposition and a format-specific MIME. Application JSON responses do not explicitly set equivalent no-store headers; add deliberate private-response caching policy for sensitive customer details. Keep sensitive form values out of URLs, analytics, logs, notifications, public provider profiles and shared client caches. A service `_id` can be a public opaque reference; internal admin/owner/payment identifiers are unnecessary public data, and no identifier replaces authorization.

## 7. Customer storefront architecture and integration points

| Exact path / component | Current behavior | Proposed focused integration |
| --- | --- | --- |
| `forntend/src/App.jsx` | Manual pathname portal selection; pushState/replaceState/popstate synchronization; customer session gate | Retain architecture; customer legal paths stay outside seller/admin portals |
| `forntend/src/components/CustomerSessionGate.jsx`, `forntend/src/utils/customerSession.js` | Verifies/restores customer session, supports guest/public paths and buyer context | Explicitly classify catalogue/detail public paths if approved; protect request/history actions |
| `forntend/src/modules/User/routes/index.jsx` | Renders LandingPage; no React Router route table | Do not assume adding a React Router route is sufficient |
| `forntend/src/modules/User/pages/LandingPage.jsx` | `renderContent` switches activeNav; header, hero, product sections; product/order overlays | Add dedicated legal catalogue/detail/request views and homepage discovery card |
| `forntend/src/modules/User/context/UserContext.jsx` | `getNavFromPath`, `setActiveNav`, browser-history state; Quick/Shop All mode preservation, products, address CRUD, orders, checkout | Extend path parsing for legal/history paths; keep service state local or in a small focused hook/context; preserve shopping mode/cart |
| `forntend/src/modules/User/components/QuickActions.jsx`, `forntend/src/modules/User/constants/index.js` | Homepage action cards with explicit click handlers | Candidate for Legal Services discovery entry after catalogue availability check; handle empty/error states honestly |
| `forntend/src/modules/User/components/UnifiedHeader.jsx` | Quick/Shop All switches, location block, product-category tabs | Optional desktop link later; avoid a third shopping/cart mode or mandatory product-category integration |
| `forntend/src/modules/User/components/BottomNav.jsx` | Home, Categories, Orders, Cart | Keep existing slots; account/home entry is sufficient initially |
| `forntend/src/modules/User/components/PopularCategories.jsx`, `DynamicCategorySection.jsx`, `forntend/src/modules/User/hooks/useCategoryTree.js`, `forntend/src/modules/User/pages/CategoriesPage.jsx` | Grocery/ecommerce product category tree and discovery | Service-local categories; do not insert legal requests into product category checkout semantics |
| `forntend/src/modules/User/pages/SearchPage.jsx` | Product text/image discovery via `/api/products/search` and featured endpoints | Separate service search initially; global search integration requires explicit result-type routing |
| `forntend/src/modules/User/pages/ProfilePage.jsx` | Account menu, saved addresses, customer support ticket listing/conversation | “My service requests” link and existing general support entry; no legal document collection in support tickets |
| `forntend/src/modules/User/pages/OrdersPage.jsx`, `OrderTrackingPage.jsx` | Product order/payment/delivery views | Keep service request history separate initially; no fake order or delivery tracking |
| `forntend/src/modules/User/components/LocationPromptModal.jsx`, `forntend/src/utils/locationState.js` | Browsing location/GPS and selection; UserContext resolves saved address/location | Prefill city/pincode only when relevant and confirmed; no required doorstep address/GPS for remote service |
| `forntend/src/modules/User/pages/CartPage.jsx`, `CheckoutPage.jsx`, `forntend/src/utils/committedCheckout.js`, `forntend/src/utils/razorpayCheckout.js` | Existing product basket, committed checkout/recovery and gateway UI | No integration in initial request release |
| `forntend/src/modules/User/components/NotificationDrawer.jsx`, `LandingPage.jsx::resolvePopupNav`, `forntend/src/utils/useNotifications.js` | Notification infrastructure exists; customer navigation resolvers currently recognize order routes only | Add allowlisted application references/routes; fetch authorized detail after navigation |
| `forntend/src/utils/api.js`, `forntend/src/utils/portalRequests.js` | Real URL normalization and bounded/portal fetch helpers | Use these with customer token and consistent envelopes/error mapping |
| `forntend/src/modules/User/services/api.js` | Mock product/category fetch functions | Not the live API client to extend for legal requests |
| `forntend/src/modules/User/User.css` | Quick aqua and Shop All indigo theme variables, fixed navigation/header/content layouts | Match inherited tokens and responsive container; shared service CSS has green hardcoded controls requiring later theme adaptation |

No customer legal-service cards/details/forms were found. The shared `ServicesPanel` cards are vendor/admin catalogue cards, not existing customer components. Reusing `DynamicFields`, validation constants and request guards is reasonable; mounting the entire vendor panel would use seller credentials/endpoints and wrong ownership semantics.

**Simplest recommendation:** combine a homepage discovery card with a dedicated Legal Services section and account request history. Add legal subcategories only inside that section after catalogue classification exists. Keep main product categories/search/cart unchanged. Initial catalogue should support name/description search and pagination; filters should be limited to real metadata (approved legal category and, if defined, free/fixed price or coverage). Do not display ratings, verified credentials, “nearby”, availability promises, or delivery estimates without data and policy.

## 8. Feature matrix: verified support versus required work

| Feature | Existing Vendor Support | Existing Backend Support | Existing Customer Support | Required Work |
| --- | --- | --- | --- | --- |
| Service creation/edit | Vendors cannot create/edit | Admin definition CRUD except delete | None | Confirm admin-owned catalogue; customer audience metadata/editor |
| Publish/unpublish | Read published only | Admin publication/version checks | None | Customer eligibility predicate and safe DTO |
| Legal classification | No structured legal category | Generic Service only | None | Explicit legal grouping; confirm actual offerings |
| Catalogue/detail | Protected vendor cards/intake | Paginated published list/detail | None | Public/customer routes and dedicated views |
| Text search/filter | Application status/date filters | No definition search/category/coverage filters | Product search only | Service-local validated search/filter contract |
| Pricing display | Free/fixed snapshot display | Admin-defined amount/currency validation | No service pricing | Explain price/collection semantics; no invented quotes |
| Provider profiles | Vendor is applicant | No service-provider relationship | Product sellers elsewhere | Decide admin fulfilment vs marketplace; curated provider DTO if needed |
| Images/public brochures | Not in definition UI | No listing media fields | Product imagery exists | Optional approved public media later; private files stay private |
| Intake documents/forms | Dynamic application form | Validated answers/private storage | No service intake | Customer-safe form policy and owner controls |
| Submit request | Approved vendor applications | Snapshot, status and key uniqueness | None | Extend applicant identity/routes and UI |
| Status/history | My applications/detail | Six-state admin workflow/events | Product orders only | Customer list/detail and admin applicant handling |
| Follow-up/deliverables | Information response/download | Private response/deliverable files | None | Customer actor/authorization; reuse private delivery |
| Quote before payment | No structured quote | No quote negotiation/acceptance | None for legal services | Business decision and separate quote state if selected |
| Appointment scheduling | None | No slots/reservations/calendar | None | Separate availability/reservation/no-show design |
| Paid booking/order | None | Service has no order/payment link | Product checkout exists | Defer; explicit service financial lifecycle |
| Cancellation/refund | No application cancellation | Product cancellation/refund only | Product flows | Service policy and states/financial obligations |
| Notifications | Vendor/admin application updates | Existing application metadata and notification service | Generic drawer, no legal deep links | Customer routing/recipient logic and minimal payloads |
| Provider messaging | Information-response loop with admin | No provider chat | Customer-admin support tickets | Admin request follow-up initially; provider messaging separate |
| Location eligibility | No service coverage | No service location/capacity checks | Saved addresses/GPS/product availability | Collect minimal location only when rules are defined |
| Retry deduplication | Busy lock, retained in-memory key | Unique vendor/key, 200 replay | Product checkout recovery, no service retry | Customer owner/key uniqueness and reload recovery |
| Delete/archive | No UI | No service/application delete endpoint | None | Prefer unpublish initially; retention/archive requires policy |

## 9. Proposed customer journey and required changes

All steps in this section are proposals, not existing customer functionality.

| Step | Customer experience | Backend work | UI work / guard |
| --- | --- | --- | --- |
| 1. Discover | Homepage Legal Services card | Eligible catalogue availability or small public query | Add entry within existing home layout; hide/handle empty catalogue without fictional listings |
| 2. Browse categories | Dedicated service section with real categories | Legal classification/audience and optional category metadata | Service-local category list; initially a flat list if no approved subcategories |
| 3. Search/filter | Search by name/description, relevant filters | Bounded query, escaped/controlled matching, pagination and deterministic sort; approved metadata predicates | Debounced search, stale-response guards, clear/loading/error/empty states |
| 4. Open detail | Read service scope and requirements | Published/customer-eligible lookup; safe DTO; explicit identifier resolution | Dedicated route with reload/back support; no product overlay assumptions |
| 5. Review | Description, approved provider identity if defined, recorded price, coverage/terms where established | Public-safe details, approved terms/coverage/provider data; no raw Seller populate | Show missing information honestly; no claimed credentials/fees/time guarantees |
| 6. Choose action | “Submit request” initially | Reuse extended application acceptance; do not create booking/payment implicitly | Explain whether payment will be arranged separately and that request is not an appointment; wording requires business approval |
| 7. Provide details | Sign in; supply minimum intake and location only if relevant | Active customer session, owner-derived identity, approved dynamic fields, server validation, private uploads, rate limits | Preserve safe return path; prefill only necessary confirmed data; no sensitive drafts in persistent browser storage |
| 8. Confirmation/status | Saved reference and My service requests | Customer list/detail projections, idempotent replay/recovery, state history | Confirmation from committed application response; allow retry safely; no implied payment success |
| 9. Follow-up/support | Respond to admin information requests; receive private deliverables; general support | Customer-owned respond/download routes and actor type, notifications; optional owned support reference | Request timeline and private downloads; allowlisted notification deep link; no unsupported provider chat |

The current workflow can express a request and administrative review, not a reserved appointment. A dynamic `date` answer is merely a submitted value: it does not reserve a slot. Similarly, text asking for an estimate is not an accepted or enforceable quote. If those richer actions are selected, design explicit states and validation before presenting them.

## 10. Proposed API and data changes (planning only)

Use a separate namespace, for example `/api/customer-services`, to avoid weakening `/api/services` vendor authorization. Exact naming remains a future implementation choice.

| Proposed operation | Required contract |
| --- | --- |
| Public eligible list/detail | Published AND customer-audience AND legal-classified definitions; allowlisted name/identifier/description/pricing and approved metadata only; paginated list; no applicant records |
| Authenticated intake definition | Only customer-approved fields/instructions plus form/service version tokens; bounded responses; recheck eligibility on submission |
| `POST /:id/applications` | `protect` plus `requireCustomerSession`; derive owner from session, never submitted user/vendor ID; multipart versions/answers/files and idempotency header; 201 or 200 replay |
| `GET /applications` and `GET /applications/:id` | Exact current-customer owner/type filter; minimal summaries then private detail; no private admin attribution/key/hash/storage path |
| `POST /applications/:id/respond` | Owner/type lookup before upload parsing; information-required only; exact application version; customer event actor |
| `GET /applications/:id/files/:fileId` | Owner/type lookup and file membership; same secure download headers/checksum controls |
| Admin processing | Reuse existing transitions where appropriate; applicant-type filters/display; permission policy resolution; notify correct customer route |

Do not make public applications searchable, expose contact information through catalogue APIs, or accept requester identity from body/query parameters. New category/search parameters need explicit validation, limits and safe matching; existing pagination is reusable but does not implement those filters. Use a canonical visibility predicate at read and acceptance boundaries, with server-derived prices/version snapshots. Legacy definitions should remain vendor-only until intentionally classified and reviewed.

No new model/index/schema/route was created during this audit. Any compatibility work or future index deployment must be separately authorized and tested against existing vendor records.

## 11. Pricing, booking, payment and communication analysis

| Question | Repository-backed answer / implication |
| --- | --- |
| Fixed, hourly, consultation fee or custom quote? | `Service.pricing` supports only **free/fixed**. No hourly units, consultation-fee designation or custom-quote model. A name/description could mention a consultation, but no structured charging contract follows from that. |
| Who defines price? | Admin `saveService` defines it; `validateDefinition` enforces amount/currency. Vendor UI cannot set it; no platform service-price calculator exists. |
| Quote before paying? | No service quote endpoint/state/accepted-quote snapshot. Information requests are an admin document/intake loop, not quote negotiation. |
| Scheduling? | No service appointment/slot model/routes or reservation/capacity logic found. Date form fields are not scheduling. |
| Razorpay reuse? | Low-level helpers are reusable candidates, not a working service payment adapter. `razorpay.service.js` provides order creation, payment/webhook signature verification, status retrieval, refund helper and paise conversion. `payment.controller.js::initiatePayment` requires an existing owned Order/payment and derives amount from order/group pricing; verify/status/settlement are likewise order-oriented. |
| Current order model supports services? | No service-specific path verified. `ORDER_TYPES` in `backend/constants/enums.js` is ecommerce/grocery/subscription; Order items have physical/digital fulfilment and product snapshots, not service/application references. A permissive item `type` string does not make checkout support legal services. Product checkout in `order.controller.js` and `UserContext` resolves cart/products, stock, fulfilment and addresses. |
| Is all nonphysical commerce absent? | No. Dedicated digital commerce already exists (`backend/routes/digitalCommerce.routes.js`, customer DigitalLibraryPage and digital checkout call). Its existence is not a legal-service fulfilment contract and it must remain untouched. |
| Payment model compatibility? | `backend/models/Payment.js` has order/group and other explicit purposes, but no ServiceApplication link. Add a deliberate service payment purpose, authoritative amount/currency/terms and settlement branch only if paid services are approved. Do not pass a service ID as an Order ID. |
| Currency compatibility? | Service definitions permit supported currencies, while the Razorpay helper/settlement shown use INR. Resolve before payment; do not silently convert or label another currency as INR. |
| Cancellation/refunds? | Application states have neither cancelled nor refunded; no applicant cancel endpoint. `order.controller.js::cancelOrder`, return services and finance/payment refund obligations concern product fulfilment. The gateway refund helper is not a service refund policy or complete automatic refund workflow. |
| Notifications/support reusable? | Generic notifications can be reused with correct recipient/deep links; service notifications currently go vendor/admin. Customer support tickets and TicketMessage conversations exist, but relate to orders/products/delivery rather than applications and communicate with support/admin, not a legal provider. |
| What blocks inactive/unapproved/unavailable booking? | There is no booking endpoint. Existing vendor requests check active User, seller approval and exact published service/version at acceptance. There is no provider approval, coverage, capacity or independent service-active check. These must be defined if introduced. |
| Duplicate submissions? | Existing UI lock/key and unique vendor/key handle retries and concurrent insert races. Customer flow needs equivalent owner/type scope, stable retry key across uncertain outcomes, conflict detection and recovery; new-key repeat intent is a separate business policy. |

A future paid-service design would need request/quote acceptance, authoritative amount in integer minor units, approved currency, service-specific payment association, payment attempt idempotency, verified capture, replay-safe webhooks, late/additional capture handling, cancellation/refund obligations, reconciliation, fulfilment gating, invoicing/tax and settlement ownership. Reuse the existing primitives only after defining those boundaries. Do not activate this work as part of the initial catalogue/request phase.

For intake, collect only contact preference and the information necessary to route the chosen service; avoid broad case narratives, identity documents or exact address until needed. Define who may read each answer/document, including support versus processing admins. If provider assignment is later added, an approved seller status must not be presented as verified legal qualification. Provider eligibility and any published credentials require their own substantiation policy.

## 12. Recommended phased implementation plan

1. **Resolve service ownership and audience.** Confirm actual Legal Services definitions with authorized business owners later; choose admin fulfilment versus provider marketplace. Approve customer-visible copy, eligible offerings, minimal intake, free/fixed display semantics, terms and privacy responsibilities. Resolve the admin permission mismatch. Exit criterion: explicit catalogue/intake/actor contract, with legacy vendor services remaining private to that audience.
2. **Read-only discovery.** Extend catalogue metadata and safe read DTOs; add dedicated legal catalogue/detail paths, homepage card, local search/pagination and service categories only as approved. No submission or checkout initially. Verify unpublished/vendor-only exclusion and route/theme/mobile behavior.
3. **Authenticated service requests.** Extend existing application identity/index strategy and event actors; add customer ownership endpoints, conservative private uploads, idempotency/recovery, admin applicant handling, status/history, information responses and deliverables. Exit criterion: complete two-customer isolation and existing-vendor regression tests, deployable private storage verified separately.
4. **Notifications and support links.** Adapt application notification routes and allowlisted customer deep links; keep payloads minimal. Link support to an owned application if needed, with no confidential support attachments until storage policy is addressed. Verify processing remains usable if push/socket delivery fails.
5. **Optional advanced services, separately approved.** Quotes, provider assignment/chat, appointment reservations or paid fulfilment only after business decisions and explicit state models. Payment integration requires its own threat/financial review and regression plan. Do not couple this release to existing finance, physical checkout, Quick Commerce, wholesale or e-book behavior.

Suggested implementation surface is the shared service files, focused customer components/hooks, minimal route/navigation additions and admin applicant rendering. Product models/cart/checkout/financial workflows are outside the first request release.

## 13. Required business decisions and unresolved questions

- What runtime offerings are called “Legal Services”? Are existing records intended for vendors only, customers, or both? No database evidence was collected.
- Who supplies and fulfils the service: platform admins, an external organization, or independent vendors/professionals? Who may see submitted information?
- Is a customer request nonbinding intake, a consultation request, a quote request, or a paid service contract? Approve the exact CTA and confirmation wording.
- What does a fixed recorded price cover? Does it include consultation, government/disbursement charges, taxes, or anything else? None of these meanings is established in source. Do not invent an amount or scope.
- Should customers pay at request, after review/quote, or outside this workflow? Is any service actually free, and what does “free” mean to the customer?
- Which currencies, invoice/tax requirements, payment recipient, commission and provider settlement model apply if payment is later added?
- Which legal categories, service locations/jurisdictions, remote/in-person modes and eligibility rules are approved? Does any request require a pincode or full address?
- What provider facts may be published, who verifies any professional credentials, and how is eligibility revoked? No current service credential model supports claims.
- What contact information/documents are essential at each stage? Define consent notices, retention/deletion, access roles, storage location/encryption, backup and incident responsibilities.
- Is scheduling required? Define timezone, slot duration, capacity, rescheduling, cancellations and no-show rules before claiming appointments are available.
- Are repeated independent requests allowed, or should some services limit concurrent active requests? Existing vendor behavior deliberately allows repeat applications.
- What happens to accepted requests if an offering is unpublished, its price changes, a provider becomes unavailable, or an applicant account is suspended? Current vendor snapshots persist; service-specific continuation/reassignment/cancellation rules are undecided.
- Should admin `role: admin` always manage services, or only superAdmin and explicitly granted accounts? Code and documentation disagree.
- Should seller-membership accounts using a buyer token access vendor service routes? Existing membership checks do not enforce the seller session helper.
- Are general support agents allowed to access any legal-request data? The current support attachment mechanism should not be assumed private enough for legal documents.
- What request acknowledgement/support expectations may be promised? No legal-service turnaround, outcome guarantee or service-level commitment was verified.

## 14. Tests, regression impact and verification commands

### Existing coverage inspected

`backend/__tests__/api/service-management.http.test.js` exercises real service routing/JWT middleware and isolated Mongo models, with user/admin/seller lookups and notifications mocked. Tests cover draft exclusion, admin/seller gates, definition/pricing validation, repeat/concurrent idempotency, private-file ownership, schema/price snapshots after edits/unpublication, workflow/reasons, information responses, deliverables, stale/concurrent edits, field/file validation, pagination/IDs/dates, private storage configuration, Unicode/aggregate limits, upload preflight, rate/concurrency/body caps, disconnects and timeouts. Replica-set mode is controlled by `SERVICE_TEST_REPLICA=1`. These tests currently assert buyers are denied; they do not prove customer integration.

`forntend/tests/service-ui.test.mjs` renders actual shared components with Vite SSR and a hook harness. Coverage includes fields/editor, escaped answers, private download controls, terminal/busy states, stale request guards, refresh/conflict recovery, notification references and unsaved input. It is not a real mobile browser or deployed end-to-end test.

Relevant existing regression suites include:

- Customer auth/navigation: `forntend/tests/auth-role.test.mjs`, `portal-startup.test.mjs`, `customer-header-insets.test.mjs`, `product-link.test.mjs`; backend `__tests__/api/customer-auth-no-referral.http.test.js` and auth/account suites.
- Product checkout/payment: `forntend/tests/checkout-ui.test.mjs`, `committed-checkout-ui.test.mjs`, `unified-basket-ui.test.mjs`; `forntend/verification/payment-ui.test.mjs`, `razorpay-overlay.test.mjs`; backend `__tests__/api/checkout-workflow.http.test.js`, `cart.api.test.js`, `razorpay-webhook.http.test.js`, `__tests__/services/razorpay.service.test.js`.
- Notifications/support: `forntend/tests/socket-ui.test.mjs`, `seller-notifications.test.mjs`; backend `__tests__/api/admin-workflows.http.test.js`, `__tests__/services/notification-push.test.js`.
- Layout: `forntend/tests/mobile-layout.test.mjs`, `visual-viewport.test.mjs`; service CSS source is responsive, but no live viewport verification occurred here.

### Required new verification

| Area | Required assertions |
| --- | --- |
| Visibility | Draft/unpublished/vendor-only services absent from public list/search/detail; publication/audience change between load and submit rejects stale intake; accepted requests remain owner-accessible per policy |
| Account/provider state | Inactive customer denied; seller-only/admin sessions denied customer actions; dual-role context tested; any future provider inactive/unapproved/unavailable cannot receive new reservations |
| Discovery | Real categories, bounded text search/filters/pagination, deterministic sort, empty/error states, no false public service fixtures |
| Details/pricing | Correct currency/precision and free/fixed semantics; no payment/appointment promise; snapshots preserved; no invented credentials or coverage |
| Validation | Required/unknown fields, number/date/options/email/phone limits, aggregate Unicode size, schema/version races, unsupported uploads, privacy-safe errors |
| Authorization | Customer A cannot list/get/respond/download B’s request; vendor cannot access customer requests by guessed ID; body owner/provider spoofing ignored/rejected; admin permission matrix includes admin-without-grant |
| Duplicate outcomes | Same-key concurrent/retried/uncertain requests yield one application; mismatched service/payload key behavior explicit; new keys follow approved repeat policy; status changes are not automatically retried |
| Privacy | Public DTO contains no admin/vendor financial/contact fields, answers, request IDs, file references or keys; private detail omits internal attribution/hashes/keys; private/no-store downloads and details; path/symlink/storage failure behavior |
| Follow-up | Customer actor transitions only when allowed; closed state rejects uploads before buffering; admin/customer conflict preserves unsaved response; authorized deliverable access |
| Navigation/mobile | Direct route/reload/back/forward, notification allowlist, sign-in return path; 320/375/430/768/1440px, long labels/IDs, keyboard focus, uploads, fixed header/bottom navigation and no horizontal overflow |
| Existing flows | Existing vendor create-via-admin/apply/respond/complete permissions and snapshots unchanged; Quick/Shop All mode/cart retained across legal navigation; checkout/payment/wholesale/e-book/finance behavior unchanged |
| Future payments only | Authoritative service price, minor-unit/currency validation, owner linkage, signed verification/webhooks, replay/late capture handling, cancellation/refund and reconciliation before any paid release |

### Commands for a later approved verification session

These commands were **not run**. Run from the indicated directory after reviewing local test availability. Backend tests write records/indexes in isolated test MongoDB and therefore require a task scope that permits those test mutations. Do not run the application server or operational scripts merely to validate this report; `backend/index.js` connects to configured infrastructure and starts background work.

```powershell
# Read-only report/repository checks from project root:
git status --short
git diff --check
git diff --stat

# Future isolated backend verification, working directory: backend
npm test -- --runInBand __tests__/api/service-management.http.test.js
# Optional replica-set pass; preserve/restore any pre-existing shell value:
$env:SERVICE_TEST_REPLICA='1'
npm test -- --runInBand __tests__/api/service-management.http.test.js
# Restore SERVICE_TEST_REPLICA before continuing.
npm test -- --runInBand __tests__/api/checkout-workflow.http.test.js __tests__/api/razorpay-webhook.http.test.js __tests__/services/razorpay.service.test.js
npm run build

# Future UI verification, working directory: forntend
npm run test:services
npm run test:auth
npm run test:startup
npm run test:checkout
node --test tests/committed-checkout-ui.test.mjs tests/unified-basket-ui.test.mjs tests/customer-header-insets.test.mjs tests/product-link.test.mjs
npm run test:payment-overlays
npm run test:socket
npm run build
# Browser harness requires its documented local browser/fixtures:
npm run test:responsive
```

`backend` build currently performs syntax and temporary packaging checks; frontend build creates `dist`. Neither is needed for this documentation-only audit. Broad suites or browser checks should be run only after inspecting their prerequisites and ensuring no live services/database are targeted. Historical counts in `SERVICE_MANAGEMENT.md` are not current acceptance results.

## 15. Explicit analysis-only confirmation

Only this requested report, `LEGAL_SERVICES_CUSTOMER_INTEGRATION_AUDIT.md`, was created for the task. **No implementation changes were made.** Application code, styles, routes, models, schemas, tests, environment files and configuration were not edited. Existing worktree changes were preserved. No database records/indexes, migrations, seeds, production operations, payments or deployments were created or initiated. All proposed capabilities and changes remain planning recommendations; unverifiable runtime facts are marked unknown.
