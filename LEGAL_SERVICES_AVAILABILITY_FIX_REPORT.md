# Legal Services availability investigation and fix

## Current behavior — Admin controls catalogue visibility

Updated 2026-10-23 following the user's clarification: **a saved customer audience plus published status controls customer visibility, without an environment switch**. This supersedes the earlier release-configuration requirement documented below as investigation history.

- Removed the catalogue environment gate from public list/detail routes and from `legalFlags`. `LEGAL_SERVICES_CATALOGUE_ENABLED` is no longer used by application code.
- Capabilities now checks whether a published customer-visible Service exists in MongoDB. Empty results return `catalogue:false`; database failures propagate through the route's error handler instead of masquerading as an empty catalogue.
- Admin now explains that checking Customer, saving, and publishing makes the service visible. Unchecking Customer or unpublishing hides it. Legacy seller-only records remain excluded until Admin explicitly selects Customer.
- Customer discovery still checks valid public catalogue results and shows errors separately from genuine empty results. Removed the obsolete “not open yet” message.
- Application submission, payment, fulfilment, refund and payout controls remain unchanged. This change governs catalogue visibility.

**Actual running local API verification after the change:**

`GET http://localhost:5050/api/customer-services/capabilities` returned HTTP 200 with `{"catalogue":true,"submissions":false}`.

`GET http://localhost:5050/api/customer-services?limit=1` returned HTTP 200 with service `6ad3575911c3e944201f3501`, “Legal Services for Businesses”, `startingPrice:{"amount":100,"currency":"INR"}`, formVersion 1 and version 2. Both required fields (`business_name` and `pan_document`) and the original description/instructions are present. The running backend loaded the change without a manual restart. No service record was edited by this agent.

Files changed for this follow-up: `backend/services/legalPolicy.service.js`, `backend/controllers/legalServices.controller.js`, `backend/routes/legalServices.routes.js`, `forntend/src/components/services/ServicesPanel.jsx`, `forntend/src/components/services/CustomerServices.jsx`, `backend/verification/legal-services.test.js`, `forntend/tests/service-ui.test.mjs`, `forntend/verification/customer-services-ui.test.mjs`, `forntend/verification/parcel-read-ui.test.mjs`, `forntend/verification/customer-service-pages-browser.mjs`, and this report.

Fresh verification: 37 backend tests, 66 focused frontend tests, and 61 production browser checks passed. Both production builds passed. Backend coverage includes Admin create/publish/apply while the obsolete environment setting is false, removing/restoring the customer checkbox without any environment configuration, unpublication, seller-only legacy records and database errors. Local API responses above independently confirm the actual existing service is now returned. The actual public requirements endpoint `/api/customer-services/catalogue/6ad3575911c3e944201f3501` also returned HTTP 200 with INR 100 and both original required fields.

## Earlier investigation (historical behavior)

Verified 2026-10-23. The live database and public HTTP responses were inspected **before application changes**. Existing unrelated worktree changes were preserved. The required code-review-graph tools were not exposed; source inspection was used after tool discovery returned no graph tools.

## Verified cause

The Admin-created business service exists and is published. It is a legacy **approved-seller offering**, not an explicitly customer-eligible offering. Independently, customer catalogue access is disabled in both the running local backend and deployed API. The customer home card read only that global capability and displayed a generic unavailable message; it did not inspect the service collection or distinguish a closed customer catalogue from an empty one.

This is not a missing record, price problem, wrong slug, unpublished record, or separate Seller/customer collection. Automatically exposing the business service would change the existing authorization/eligibility rules. No live service or release configuration was changed.

## Actual database record

Read-only MongoClient inspection used the configured backend MONGO_URI, without importing server startup, seeds, index preparation or application models. The initial sandboxed DNS lookup timed out; the authorized network retry succeeded. Credentials were not printed.

| Field | Observed value |
| --- | --- |
| Database / collection | `bulkimart.services` |
| `_id` | `6ad3575911c3e944201f3501` |
| `name` / `slug` | `Legal Services for Businesses` / `legal-services` |
| `status` | `published` |
| `pricing` | `{ mode: "fixed", amount: 100, currency: "INR" }` — major currency units |
| `createdBy` | `6ac935337f8251be9726e8e1` |
| `createdAt` | `2026-10-17T11:09:13.101Z` |
| `publishedAt` | `2026-10-17T11:09:25.047Z` |
| `__v` | `1` |
| `audiences` | Absent in the raw document. Legacy records are deliberately included in Seller queries and excluded from customer queries. Mongoose's default for new records is `['vendor']`. |
| Active status | No `isActive` or `active` field in the inspected record; the Service schema has no separate active flag. Publication controls record visibility; the release flag separately controls customer catalogue access. |
| Service type | No `type`, `serviceType` or `legalCategory` value in the inspected record. Neither catalogue infers eligibility from the name or slug. |
| Seller association | No `seller`, `sellerId` or `vendor` reference in the inspected record. Admin owns catalogue management; sellers are applicants, not the providers/owners of this offering. |
| Required fields | `business_name`: required text, 2–99 characters; `pan_document`: required PDF/PNG/JPG, maximum 5 MiB. |

Only one service document was returned by the bounded inspection. No records were created, duplicated, edited or published in the configured database.

## API and connection comparison

Both frontend portals use the same `apiUrl` helper. Development environment files point to `http://localhost:5050`; the production build points to `https://api.bulkimart.in`. Both route families import the same `Service` model, which uses the backend's default Mongoose connection and the `services` collection. No alternate customer database connection exists in these controllers. The deployed process's private environment was not inspected, so an independent deployed database fingerprint is not claimed.

| Surface | Request and response | Filtering / authorization |
| --- | --- | --- |
| Seller `/seller/services` | `GET /api/services?page=1&limit=20`; `{ success, data: Service[], meta: { total, page, limit } }`; requirements at `GET /api/services/:id`. Price is `data[].pricing.amount`. | Published AND (`audiences` includes `vendor` OR raw `audiences` is absent). Requires authenticated seller role and approved seller profile. No seller ownership filter applies to the catalogue. |
| Customer home | `GET /api/customer-services/capabilities`; `{ success: true, data: { catalogue, submissions }, meta: {} }`. Previously used only `catalogue === true`. Now also checks `GET /api/customer-services?page=1&limit=1` when enabled. | Capability is `LEGAL_SERVICES_CATALOGUE_ENABLED === 'true'`, not a count of Admin services. |
| Customer catalogue | `GET /api/customer-services?q=&page=1` (optional `limit` and `category`); safe DTO array with `startingPrice`, `fields`, `formVersion`, `version`; requirements at `GET /api/customer-services/catalogue/:id`. | Capability must be enabled, AND published AND `audiences` includes `customer`. No automatic legacy/vendor fallback. Detail requires the MongoDB ID, not the slug. |
| Customer apply | `POST /api/customer-services/catalogue/:id/applications`, multipart answers/files/versions and idempotency key. | Verified buyer session, explicit customer audience, published record, submissions flag, index preparation, form/version validation and existing production release block. |

Actual unauthenticated HTTP observations, before changes:

| Origin | Request | Observed response |
| --- | --- | --- |
| Local and deployed | `/api/customer-services/capabilities` | HTTP 200: `{"success":true,"data":{"catalogue":false,"submissions":false},"meta":{}}` |
| Local and deployed | `/api/customer-services?limit=1` | HTTP 503: `success:false`, `data:null`, message `Legal Services capability is not enabled`. |
| Local and deployed | `/api/services?page=1&limit=20` | HTTP 401: `AUTH_HEADER_MISSING`, `Not authorized — no token provided`. |

No authenticated live Seller session was supplied, so the Seller screenshot's authenticated HTTP payload was **not** independently captured. Its exact observed record was confirmed directly in the configured database, and the actual Seller query explains why that record is returned. The authenticated Seller/customer response comparison was additionally exercised through real Express routes against an isolated replica-set database; no live token was forged or role check bypassed.

## Existing requirements and publishing workflow

`SERVICE_MANAGEMENT.md` defines Admin-managed services for approved sellers. The customer extension in `Service.js`, `serviceForms.service.js` and `legalServices.controller.js` adds explicit customer audiences while retaining vendor-only legacy behavior. The existing tests specifically require exclusion of legacy services and drafts from customers.

Admin creation saves a draft. `POST /api/admin/services/:id/publication` explicitly publishes it, with an optimistic version check; saving does not publish. For an eligible customer offering, Admin must select **Customer Legal Services (explicit eligibility)**, save the **existing** record and publish it if not already published. Retain Vendor applications if both audiences are intended. This record is already published, so another publish alone would not fix its missing audience.

Customer catalogue release configuration must also permit access. `LEGAL_SERVICES_CATALOGUE_ENABLED` and `LEGAL_SERVICES_SUBMISSIONS_ENABLED` are separate; enabling browsing does not authorize applications. Existing production operational release blocks remain. No approval, audience migration or release enablement is inferred merely from a business service's name or the task to investigate it.

## Exact files changed in this task

- `forntend/src/components/services/CustomerServices.jsx`: home discovery now checks the actual public catalogue after an enabled capability; distinguishes disabled access, validated empty catalogue, loading, success and error. HTTP/network failures, false success envelopes, missing data/meta and incorrect record IDs produce a retryable error. Disabled text says customer services are not open yet, rather than implying Admin has no services. The legacy hub uses the same clearer disabled wording and rejects unsuccessful capability envelopes.
- `forntend/src/components/services/LegalServices.jsx`: rejects unsuccessful envelopes, malformed catalogue responses and detail-ID mismatches through the existing retryable error UI. Keeps failed reads separate from genuine empty results and preserves service fields, versions, prices and application/payment actions.
- `forntend/src/components/services/ServicesPanel.jsx`: Admin list shows effective audience and customer eligibility separately from publication. Editor explains that publication, explicit customer eligibility and release configuration are distinct. Seller price, requirements and submission flow are unchanged.
- `backend/verification/legal-services.test.js`: real isolated HTTP coverage of Admin create/publish/customer detail/apply/unpublish, INR 100 price preservation, required fields, guest rejection, legacy audience exclusion, approved Seller inclusion and disabled customer capability.
- `forntend/verification/customer-services-ui.test.mjs`: discovery and malformed-response/error/retry/loading/empty/disabled/cancellation regressions.
- `forntend/verification/parcel-read-ui.test.mjs`: updates the existing legal-card test to supply the newly required public-catalogue response and check the clearer disabled wording.
- `forntend/tests/service-ui.test.mjs`: Admin publication/audience visibility checks.
- `forntend/verification/customer-service-pages-browser.mjs`: production browser checks for home discovery in disabled/empty/error/available states, navigation to the exact service ID, INR 100.00 requirements and required applicant field; retains previous responsive and parcel regressions.
- This report, `LEGAL_SERVICES_AVAILABILITY_FIX_REPORT.md`.

No backend application/model/controller/route, live database, environment, authentication rule or business eligibility filter was changed.

## Fresh verification

| Command | Result |
| --- | --- |
| Backend: `node verification/run-shopping-capacity-tests.mjs --config verification/jest.config.js --runInBand --runTestsByPath verification/legal-services.test.js` | **35 passed, 0 failed**, real isolated MongoDB replica set. No developer URI/provider credentials inherited. |
| Frontend: `node --test verification/customer-services-ui.test.mjs verification/parcel-read-ui.test.mjs verification/legal-services-ui.test.mjs tests/service-ui.test.mjs tests/auth-role.test.mjs tests/portal-startup.test.mjs` | **114 passed, 0 failed**, including valid uppercase ObjectId links. |
| Frontend: `node verification/customer-service-pages-browser.mjs` | **61 browser views/checks passed**, 320/360/375/390/430/768/1024px plus home discovery and requirements checks; no runtime exceptions. API responses intercepted. Evidence: `test-artifacts/customer-service-pages/results.json`. |
| Frontend: `npm run build` | Passed; existing large-bundle warning. |
| Backend: `npm run build` | Passed: syntax and backend service-package/shared-limits checks. |
| Root: scoped `git diff --check` | Passed; informational LF/CRLF notices only. |

Draft, unpublished and disabled-platform states were tested separately. There is no independent Service `isActive` lifecycle to test: unpublished is the supported inactive record state. API failures and invalid responses are asserted as errors, not empty catalogues. The full create/publish/apply test operates only in the isolated database; live publication, live applications, payment operations and deployment were not performed.

The live business record will correctly remain hidden from customers until an authorized Admin classifies it for customers and the customer catalogue release is enabled. This patch makes that distinction visible and reliable; it does not silently widen access.
