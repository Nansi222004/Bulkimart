# GST registration assistance implementation

Date: 2026-10-22. **Implemented for isolated evaluation; production activation remains disabled and blocked.** No deployment, configured database connection, government filing, payment, production index operation or production data mutation was performed. Unrelated parcel, driver-capacity and other starting worktree changes were preserved. AGENTS.md was read; code-review-graph tool discovery returned no tools, so its permitted source-search fallback was used.

## Inspection and scope

Existing registration uses `SellerContext.jsx` / `OnboardingPage.jsx`, seller `/start`, `/step/1`–`/step/4` and `/submit` APIs, and the `Seller` application document. The browser has nine screens; backend step four persists legal documents and advances onboarding to five. Seller activation remains the existing separate admin approval and User seller-role grant. Current statuses are incomplete, pending, under_review, approved, rejected and suspended.

Contrary to the request's assumed presentation, this checkout had **no visible registration GSTIN input and no GSTIN validator or verification integration**. The backend accepted an optional GSTIN string. The new explicit Yes path checks 15-character format only; it does not introduce government verification or change legacy callers that omit `gstChoice`. Existing PAN requirements, Aadhaar/bank uploads, seller status, sales-channel selection and approval rules remain intact.

No approved GST assistance intake checklist, practitioner authorization, no-GSTIN selling policy or government adapter was found in source. Initial assistance therefore collects only contact name, optional assistance message and consent, with a snapshot of already provided business name/type/state/pincode and authenticated contact phone. It does not collect another Aadhaar/PAN/bank scan or reuse legacy KYC URLs. A reviewer may request specific information and private documents later. This is assistance intake, not a government GST registration application.

The existing private service storage and bounded multipart-upload controls are reused. Legacy onboarding uploads return Cloudinary URLs; those flows were preserved, and their URL references were not imported into GST assistance. New assistance documents have opaque identifiers, byte/type/size validation, private filesystem permissions and authenticated downloads, never public storage URLs.

## Completed behavior

- Registration asks “Do you have a GSTIN?” with explicit Yes/No. Yes displays GSTIN; No asks whether to request assistance or continue without GST. An unanswered choice cannot advance the new UI. Assistance requires server capability availability, contact name and explicit purpose-limited consent.
- Declining still permits submitting an application for the existing vendor review. It is not a GST exemption, automatic approval or permission to sell. No new selling eligibility or bypass was added.
- `GstAssistanceRequest` is a dedicated collection. Its `_id` is the associated Seller application ID, using MongoDB's built-in unique identity to prevent duplicate requests without a new unique-index dependency. Creation and seller progression share a retried Mongo transaction. Identical active retries return the same request; changed active submissions conflict. Rejected/cancelled/completed requests cannot be silently recreated; a new application/resubmission policy needs separate approval.
- Requests record original no-GSTIN status, vendor/application/user association, submitted details, versioned consent/date, submission/audit timestamps, reviewer and status events. No GSTIN or government application reference is generated.
- Statuses: pending, under_review, additional_information_required, approved, rejected, completed, cancelled. Server-defined transitions and integer versions prevent stale/racing writes. Vendor responses require an information request and return to under_review. Vendors can cancel only pending requests. Admins can add internal notes, assign an authorized reviewer (the UI supports “Assign to me”), request corrections and communicate vendor-visible next steps.
- Assistance `approved` means the request for assistance was accepted, not government approval. Completion requires a correctly formatted GSTIN, an authorized admin's explicit independent-review attestation, actual private verification evidence and a supplied evidence reference. Verification records actor/time/source/method. This is **manual, evidence-backed review**, not an automated government verification result. Vendor GSTIN, seller approval and selling rights are not changed automatically.
- Admin workspace is linked in Vendor Management. It supports paginated status filters, request details, reviewer assignment, notes, validated transitions, evidence uploads/downloads and audit history. Backend requires active authenticated Admin plus superAdmin or `manage_sellers`; a generic admin identity alone is insufficient.
- Vendor status appears in the approved dashboard, the pending/rejected/suspended status gate and the registration submission screen. Pending vendors can respond without gaining approved-seller access. Private staff notes, reviewer identities and staff verification files are withheld from vendor DTOs. Download ownership is checked independently of knowing an opaque file ID.
- Uploads accept only validated PDF/JPEG/PNG, at most three files per action and 5 MB per file. Existing aggregate multipart, per-account concurrency, timeout and rate controls apply. Request totals are bounded at 30 files/500 events. Failed/version-conflicting commands remove newly stored files; committed files remain evidence. Downloads use attachment, no-store, nosniff and sandbox headers and verify file hashes before streaming.
- Existing notification transport is reused after commits. Notifications contain generic next-step messages, without documents, notes, phone numbers or GSTINs. Failures cannot undo the committed request; explicit refresh is authoritative. Admin broadcast delivery remains best effort, without a new outbox/retry subsystem.
- Frontend requests use existing portal/session conventions and bounded timeouts. Older detail responses cannot replace a more recently selected request. Switching vendors clears entered verification GSTIN, evidence reference and attestation; registration contact/consent state is cleared on seller identity changes and is not written into local drafts.

## API and activation

Customer identities cannot use a delivery portal session to access vendor APIs. Vendor routes use existing `protect` / `requireSellerSession`, then resolve the owning Seller application. Admin routes independently enforce vendor-management permission. Private responses use `Cache-Control: private, no-store`.

| API under `/api` | Purpose |
| --- | --- |
| `GET /sellers/gst-assistance/capabilities` | Public enabled/production-block state only |
| Existing `PUT /sellers/step/4` | Optional explicit `gstChoice`: has_gstin / assistance / without_gstin; assistance also requires gstContactName and gstAssistanceConsent=true; gstAssistanceMessage is optional |
| `GET /sellers/gst-assistance/me` | Owned request, vendor-safe files and history |
| `POST /sellers/gst-assistance/me/actions` | Multipart version + respond/message/requested documents, or pending cancel |
| `GET /sellers/gst-assistance/me/files/:fileId` | Owned vendor-response document download |
| `GET /admin/gst-assistance?status=...&page=...` | Authorized queue, 30 rows/page |
| `GET /admin/gst-assistance/:id` | Authorized detail and full audit |
| `POST /admin/gst-assistance/:id/actions` | Multipart version + transition/note/assign; completion evidence and attestation are additionally required |
| `GET /admin/gst-assistance/:id/files/:fileId` | Authorized private document download |

`GST_ASSISTANCE_ENABLED` defaults false and was not configured true. Parcel-specific flags were not changed. Even a true flag cannot enable assistance mutations under production/prod/deployment-production runtime/deployment aliases. Local `.env*` and this process were checked only for the new GST flag; no override was found. The UI capability check fails closed. Default-disabled assistance does not disable legacy optional-GST onboarding or the explicit Yes/decline paths. Read access remains authenticated for existing evidence when intake is paused.

## Changed files

| Files | Reason |
| --- | --- |
| `backend/models/GstAssistanceRequest.js` | Dedicated identity, consent, versions, statuses, documents and audit; automatic creation/indexing disabled |
| `backend/models/Seller.js` | Optional registration decision; existing GSTIN remains unchanged in meaning |
| `backend/services/gstAssistance.service.js` | Capability/production gates, explicit-path parsing, idempotent creation, private DTOs |
| `backend/controllers/gstAssistance.controller.js` | Scoped review, transitions, notes, evidence, reviewer checks, notifications and downloads |
| `backend/routes/gstAssistance.routes.js`, `backend/routes/index.js` | Separate vendor/admin routers mounted before generic portal routers; prior parcel routes preserved |
| `backend/controllers/seller.controller.js` | Assistance request and step-four progression commit together; legacy calls retained |
| `backend/config/gst-assistance.env.example` | Disabled configuration documentation only |
| `forntend/src/components/gst/{GstDecision.jsx,GstAssistance.jsx,gstApi.js}` | Registration decision, vendor/admin workspaces, private bounded API calls and status labels |
| `forntend/src/modules/Seller/{context/SellerContext.jsx,pages/OnboardingPage.jsx,pages/DashboardPage.jsx,components/SellerStatusGate.jsx}` | Request submission, validation, identity reset and status visibility before/after seller approval |
| `forntend/src/modules/Admin/{routes/index.jsx,components/LeftSidebar.jsx}` | Existing-shell workspace/navigation |
| `backend/verification/gst-assistance.test.js`, `forntend/verification/gst-assistance-ui.test.mjs` | Isolated actual API/DB/private-filesystem tests and real-component hook tests |
| This report | Evidence, policy boundaries and release prerequisites |

## Validation

Logs: `test-artifacts/gst-assistance/`. Backend tests run through the existing OS-only environment launcher from the capacity work: it invokes Jest with experimental VM modules and excludes configured application/database/provider credentials. Tests start their own MongoMemoryReplSet 7.0.14 and temporary private storage; only notification/legacy upload network boundaries are replaced. No application bootstrap/dotenv, real storage provider or government service was started. New tests do not claim browser E2E coverage: frontend checks use Vite-loaded actual components and the repository hook harness.

| Exact command (package directory) | Result |
| --- | --- |
| Backend: `node verification/run-shopping-capacity-tests.mjs --config verification/jest.config.js --runInBand --runTestsByPath verification/gst-assistance.test.js verification/legal-services.test.js verification/financial-workflow.test.js verification/parcel-shopping-capacity.test.js` | **114 passed, 0 failed/skipped, 4 suites**, 37.495 s; `backend-final.log` |
| Backend after final retry-snapshot/document-merge adjustment and explicit missing-PAN regression: `node verification/run-shopping-capacity-tests.mjs --config verification/jest.config.js --runInBand --runTestsByPath verification/gst-assistance.test.js` | **25 passed, 0 failed/skipped**, 5.318 s; `gst-final.log` |
| Backend: `node verification/run-shopping-capacity-tests.mjs --config __tests__/jest.config.js --runInBand --runTestsByPath __tests__/api/seller-phone-auth.http.test.js __tests__/api/seller-pickup-sync.http.test.js __tests__/api/seller-profile-wholesale.http.test.js __tests__/api/service-management.http.test.js __tests__/services/onboarding-regressions.test.js __tests__/models/seller-schema.test.js __tests__/utils/seller-onboarding-draft.test.js` | **123 passed, 0 failed/skipped, 7 suites**, 32.352 s; `backend-regressions.log` |
| Frontend: `node --test verification/gst-assistance-ui.test.mjs tests/auth-role.test.mjs tests/portal-startup.test.mjs tests/service-ui.test.mjs tests/seller-profile-wholesale.test.mjs` | **97 passed, 0 failed/skipped**, 22.042 s; `frontend-final.log` (10 new GST checks) |
| Backend: `npm run build` | **Passed** service imports/shared limits; `backend-build.log` |
| Frontend: `npm run build` | **Passed**, final Vite build 1.62 s; existing >500 kB chunk warning remains; `frontend-build-final.log` |
| Root: `git diff --check` | **Passed**, informational LF/CRLF notices only; `diff-check.log` |

Coverage includes explicit GSTIN Yes/No, decline versus assistance, legacy optional GST strings, required consent/PAN, concurrent duplicates, changed submissions, access isolation, portal/admin authorization, status/version races, pending cancellation, additional information, audit visibility, rejected shortcuts, private downloads, forged/malformed files, orphan cleanup, transaction rollback, notification failure and production aliases. Completion fixtures are explicitly synthetic, not real government-issued evidence or GST registrations.

Early fixture-import attempts failed before running tests because the test mocks omitted unrelated exports imported by the full seller router. The mocks were corrected to preserve those exports; no production implementation/assertion was relaxed. Initial successful development runs had 21 GST backend and 95 selected frontend tests before the additional rollback/race/navigation tests. The selected final suites are all green. The full backend suite was **not rerun for this task**. Its prior ten baseline failures and five wholesale runtime failures (all wholesale tests passed on the prior isolated rerun) remain documented separately in [the parcel/capacity report](PARCEL_DELIVERY_IMPLEMENTATION_REPORT.md#concurrent-shopping-capacity-fix); they are not presented as a fresh GST test result.

## Decisions and release prerequisites

1. Approve the operating scope, staff authorization, purpose/consent wording and an actual GST assistance checklist. No business record established Bulkimart as an authorized practitioner; this implementation makes no such claim and grants no government-filing mandate.
2. Approve vendor GST eligibility rules before enabling a real assistance programme. Source currently permits optional-GST application review, not a universal legal exemption. The official [GST Council description of Notification 37/2023](https://gstcouncil.gov.in/node/4392) identifies a special procedure for e-commerce supplies by unregistered persons; this source does not establish eligibility for every Bulkimart vendor. No turnover/category/inter-state exemption engine or selling restriction was invented. Where a GSTIN is legally required, staff must withhold seller approval until the existing onboarding requirement is satisfied; this feature does not grant or automate that eligibility decision.
3. Approve retention/access/deletion procedures, private storage configuration, encryption/backup controls, staff evidence handling and any malware-scanning requirement. Existing validation checks file signatures/size/hash; it is not antivirus or an assessment of document truth. No guessed TTL or destructive cleanup was introduced. Account deletion/anonymization handling for the new request collection and its files still needs an approved retention design; current account-cleanup tooling is not extended to delete GST evidence.
4. Define legitimate resubmission after rejection/cancellation, and how independently reviewed GSTIN details should update the existing seller GST record. Neither is silently automated here. No government filing adapter, certificate generation, paid service, application fee or payment workflow was added.
5. Before any separately approved release, confirm transactional Mongo support and review creation of the new collection (only its built-in `_id` uniqueness is required). The schema uses `autoCreate: false` / `autoIndex: false`; no production collection/index command was run. Exercise multi-worker restart, storage outage, account switching, full browser registration/review and real operational evidence handling in isolated staging first.

Rollback: stop new assistance intake first. Keep authenticated read access and private files/audit evidence for existing requests. Do not delete documents, reset statuses or remove request identity to simulate cancellation. There is no money movement to reverse. Keep the optional Seller field and collection until the retention decision permits reviewed cleanup. **Safe next step: isolated staging with synthetic vendors, private temporary storage and the feature flag enabled only in that isolated environment. Production is not authorized.**
