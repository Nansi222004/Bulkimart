# Platform Storage Audit (Phase 1)

Status: **Phase 1 complete (static inspection only).** Nothing has been migrated, implemented or tested.
Date: 2026-10-31. Method: static reading of `backend/`, `frontend/`, `mobile-user/`, `mobile-seller/`. No code, scripts, package managers or database queries were run (machine is under the PolinRider containment rule). The code-review-graph MCP server was unavailable, so the audit used direct file search.

Companion documents: [architecture](CENTRAL_STORAGE_ARCHITECTURE.md) · [API](STORAGE_API_SPECIFICATION.md) · [security](STORAGE_SECURITY_REPORT.md) · [migration plan](CLOUDINARY_MIGRATION_PLAN.md) · [test plan](STORAGE_MIGRATION_TEST_PLAN.md) · [infrastructure](STORAGE_INFRASTRUCTURE_REQUIREMENTS.md) · [workflow checklist](STORAGE_WORKFLOW_CHECKLIST.md)

---

## 1. Summary

| Fact | Detail |
|---|---|
| Storage paths in use | **3**: Cloudinary (most media), backend local-disk *fallback* (`backend/uploads/`), and two existing private server stores (`EBOOK_STORAGE_DIR`, `SERVICE_STORAGE_DIR`). |
| Client-direct Cloudinary uploads | **None.** Every web and Android client uploads multipart to the backend; only the backend talks to Cloudinary. Client migration is therefore mostly backend-side. |
| Central upload function | `uploadToCloudinary()` / `uploadFileWithMeta()` in [cloudinary.service.js](../backend/services/cloudinary.service.js). 21 call sites in 13 controllers/routes. |
| Cloudinary-only feature | Storefront video upload calls the Cloudinary SDK directly and relies on **Cloudinary transcoding** (H.264 MP4, ≤15 s, ≤1280 px) — [storefront.routes.js:44-57](../backend/routes/storefront.routes.js#L44-L57). |
| Upload parsing | Multer `memoryStorage()` everywhere (whole file in RAM). Largest limits: 50 MB bulk ZIP, 25 MB e-book (configurable to 250 MB), 15 MB storefront video. |
| Upload workflows found | **23 live** + 1 dormant + seed scripts (inventory §3). |
| Already on our server | E-book PDFs; Service / Legal / GST-assistance documents. |
| Delivery evidence uploads | **Do not exist.** Delivery completion is OTP-only; there is no pickup/delivery/handover/failed-delivery photo feature in any client or backend route (§5). |
| Native delivery app | **Does not exist.** Delivery partner portal is web-only (`frontend/src/modules/Delivery`). |

## 2. Storage paths in detail

### 2.1 Cloudinary (primary)
- Config: [backend/config/cloudinary.js](../backend/config/cloudinary.js) (`CLOUDINARY_URL` or the three individual vars; validated at startup in [index.js:41](../backend/index.js#L41)).
- All uploads land under `nhcone/<folder>` with `resource_type: 'auto'` and the default **`upload` (public) delivery type** — every stored URL, including KYC, is publicly fetchable by anyone holding it.
- Deletion: `deleteFromCloudinary()` is defined but has **no callers**. Only `removeFailedProductUploads()` ([productUploadCleanup.service.js](../backend/services/productUploadCleanup.service.js)) deletes, and only for B2B-only product creation failures. Replaced logos, avatars, banners, KYC re-uploads etc. are orphaned.

### 2.2 Local-disk fallback (`saveLocally`)
- [cloudinary.service.js:11-34](../backend/services/cloudinary.service.js#L11-L34). Used whenever Cloudinary is unconfigured or rejects an upload, for folders not on the "sensitive" list.
- Writes to `backend/uploads/<folder>/<uuid>.<ext>` — **inside the backend source/deploy directory** (git-ignored).
- Returns `/uploads/...` (or `PUBLIC_API_URL` + path), **but no route serves `/uploads`**. [index.js:91-104](../backend/index.js#L91-L104) only serves the frontend build, and its SPA catch-all answers `/uploads/*` with `index.html` and HTTP 200. Fallback-stored images are therefore silently broken.
- Several clients already prefix `/uploads/` URLs with the API origin (`mediaUrl` in [mobile-user/src/api/client.js:20](../mobile-user/src/api/client.js#L20), `CategoryArtwork`, `HeaderCategories`, `StorefrontMedia`, `StorefrontSections`, `SponsoredCategoryBlock`), and [storefrontPolicy.service.js:59](../backend/services/storefrontPolicy.service.js#L59) accepts `/uploads/...` media. The URL contract exists; the serving side does not.
- Extension detection only distinguishes PNG/PDF/"RIFF" (assumed WebP); everything else, including SVG, is saved as `.jpg`.

### 2.3 Existing private server stores (keep; they are the pattern to generalise)
| Store | Module | Config | Behaviour |
|---|---|---|---|
| E-books | [ebookStorage.service.js](../backend/services/ebookStorage.service.js) | `EBOOK_STORAGE_DIR` (mandatory in prod), `EBOOK_MAX_UPLOAD_BYTES` | UUID names, temp→verify SHA-256→rename, 0700/0600 modes, refuses public dirs, hash verified on read, streamed download. |
| Service/Legal/GST docs | [serviceStorage.service.js](../backend/services/serviceStorage.service.js) | `SERVICE_STORAGE_DIR` (mandatory in prod) | UUID names, magic-byte validation for PDF/PNG/JPEG, 5 MB, hash verified on read. |

Default dev locations are `backend/private-data/{ebooks,services}` — also inside the source tree; production refuses to start storage without the env var.

## 3. Workflow inventory

Columns: **App** (W = customer web, CA = `mobile-user`, SW = seller web, SA = `mobile-seller`, DW = delivery web portal, AP = admin panel). **Vis** = target visibility (Pub = public, Priv = authenticated/signed). Line numbers are current as of this audit.

### 3.1 Customer

| ID | Feature | App | File type / limit | Route → controller | Folder | MongoDB field | Today's access | Vis | Authorization required |
|---|---|---|---|---|---|---|---|---|---|
| C1 | Profile photo | W, CA ([ProfileScreen.jsx:125](../mobile-user/src/screens/ProfileScreen.jsx#L125)) | JPEG/PNG/WebP/SVG/PDF*, 5 MB | `PUT /api/users/profile` (`avatar`) → [user.controller.js:63](../backend/controllers/user.controller.js#L63) | `avatars` | `User.avatar` | Public Cloudinary URL | Pub (low-sensitivity) | Owner writes; anyone authenticated may view |
| C2 | Address landmark photo | W ([UserContext.jsx:1322](../frontend/src/modules/User/context/UserContext.jsx#L1322)), CA ([UserContext.jsx:703](../mobile-user/src/context/UserContext.jsx#L703)) | same | `POST /api/users/addresses/upload-landmark` → [user.controller.js:101](../backend/controllers/user.controller.js#L101) | `landmark-images` | `User.addresses[].landmarkImage`; **snapshot** copied to `Order.shippingAddress.landmarkImage` ([Order.js:274](../backend/models/Order.js#L274)) | Public URL | **Priv** (reveals home) | Owner; assigned rider/seller for that order; admin |
| C3 | Product review photos | W ([WriteReviewPage.jsx:101](../frontend/src/modules/User/pages/WriteReviewPage.jsx#L101)), CA ([WriteReviewScreen.jsx:84](../mobile-user/src/screens/WriteReviewScreen.jsx#L84)) | JPEG/PNG/WebP, 4 × 5 MB | `POST /api/products/:id/reviews` → [product.controller.js:1330](../backend/controllers/product.controller.js#L1330) | `reviews` | `Product.reviews[].images` | Public URL | Pub once approved | Reviewer writes; admin moderates |
| C4 | Return request evidence | W ([OrderTrackingPage.jsx:287](../frontend/src/modules/User/pages/OrderTrackingPage.jsx#L287)), CA ([OrderTrackingScreen.jsx:217](../mobile-user/src/screens/OrderTrackingScreen.jsx#L217)) | 5 files × 5 MB, img/PDF | `POST /api/returns` → [return.controller.js:31](../backend/controllers/return.controller.js#L31) (`uploadFileWithMeta`) | `returns` | `Return.attachments[{url,publicId,fileName,mimeType}]` | Public URL | **Priv** | Customer owner; seller of the line; admin; return-pickup rider if surfaced |
| C5 | Support ticket attachments | W ([useTickets.js:65](../frontend/src/utils/useTickets.js#L65)), CA ([useTickets.js:39](../mobile-user/src/hooks/useTickets.js#L39)) | 5 × 5 MB | `POST /api/tickets`, `/:id/messages` → [ticket.controller.js:20](../backend/controllers/ticket.controller.js#L20) | `support-tickets` | `Ticket.attachments`, `TicketMessage.attachments` | Public URL | **Priv** | Requester; admins with ticket permission |
| C6 | Service / Legal / GST documents | W (`ServicesPanel`, `LegalServices`, `GstAssistance`), CA (`LegalServices`, `ServicePayment`) | PDF/PNG/JPEG, 5 MB | service, legal, GST routes via `serviceUploadControls` | private store | `ServiceApplication` files `{fileId,sha256,...}` | **Already server-private** | Priv | Existing controller checks — keep |
| C7 | Image search query | W, CA ([ImageSearchSheet.jsx](../mobile-user/src/components/ImageSearchSheet.jsx)) | image, `IMAGE_SEARCH_MAX_BYTES` | `/api/image-search` | — | not stored | Transient | — | Out of storage scope (see §6 dependency) |

\* The generic `uploadSingle` filter also admits `image/svg+xml` and `application/pdf` for avatars/landmarks — see security report.

### 3.2 Seller

| ID | Feature | App | File type / limit | Route → controller | Folder | MongoDB field | Today | Vis | Authorization |
|---|---|---|---|---|---|---|---|---|---|
| S1 | Product images (retail, grocery, wholesale, e-book cover) | SW ([SellerContext.jsx:436,1389](../frontend/src/modules/Seller/context/SellerContext.jsx#L1389)), SA ([productForm.js:107,127](../mobile-seller/src/utils/productForm.js#L107)) | JPEG/PNG/WebP/SVG, 5 × 5 MB | `POST/PUT /api/products` → [product.controller.js:809](../backend/controllers/product.controller.js#L809), [:1055](../backend/controllers/product.controller.js#L1055) | `products/<sellerId>` | `Product.images[]`; **snapshots** in `Order.items[].image`, `Return.productImage`, cart lines | Public URL | Pub | Seller owns product; admin may edit |
| S2 | Bulk upload (sheet + image ZIP) | SW ([BulkUploadModal.jsx:88](../frontend/src/modules/Seller/components/BulkUploadModal.jsx#L88)) | xlsx/csv ≤10 MB, zip ≤50 MB | `POST /api/products/bulk/upload` → [bulkProduct.controller.js:175](../backend/controllers/bulkProduct.controller.js#L175) | `products` (**not** per-seller) | `Product.images[]` | Sheet/ZIP not persisted; images public | Pub | Approved seller session |
| S3 | E-book PDF | SW ([SellerContext.jsx:500,1466](../frontend/src/modules/Seller/context/SellerContext.jsx#L1466)) — not in `mobile-seller` | PDF, 25 MB default | `POST /api/products/:id/digital-file` | private store | `Product.digital.file` (`fileId` select:false), `Order.items[].digitalFile` | **Already server-private**; entitlement-checked download | Priv | Keep existing ownership + entitlement checks |
| S4 | Aadhaar front/back | SW ([SellerContext.jsx:1308](../frontend/src/modules/Seller/context/SellerContext.jsx#L1308)), SA ([onboarding.api.js:23](../mobile-seller/src/services/onboarding.api.js#L23)) | img/PDF 5 MB | `PUT /api/sellers/step/2` → [seller.controller.js:194-195](../backend/controllers/seller.controller.js#L194-L195) | `seller-kyc/<userId>` | `Seller.aadhaar.frontUrl/backUrl` | **Public URL** | **Priv-KYC** | Owner (upload only); admin with seller permission; audited |
| S5 | Bank passbook | SW, SA ([onboarding.api.js:32](../mobile-seller/src/services/onboarding.api.js#L32)) | same | `PUT /api/sellers/step/3` → [seller.controller.js:232](../backend/controllers/seller.controller.js#L232) | `seller-bank/<userId>` | `Seller.bankDetails.passbookUrl` | **Public URL** | **Priv-KYC** | as S4 + finance |
| S6 | PAN card / trade licence | SW, SA ([onboarding.api.js:44](../mobile-seller/src/services/onboarding.api.js#L44)) | same | `PUT /api/sellers/step/4` → [seller.controller.js:281](../backend/controllers/seller.controller.js#L281) | `seller-docs/<userId>` (**not** in sensitive list) | `Seller.documents[{type,url}]` | Public URL, or **silently to unserved local disk** on Cloudinary failure | **Priv-KYC** | as S4 |
| S7 | Store logo / banner | SW, SA ([settings.api.js:32](../mobile-seller/src/services/settings.api.js#L32)) | img 5 MB | `PUT /api/sellers/profile` → [seller.controller.js:409,412](../backend/controllers/seller.controller.js#L409) | `seller-branding/<userId>` | `Seller.storeDetails.logo/banner` | Public URL | Pub | Owner; admin |
| S8 | Seller account avatar | SW | img 5 MB | `PUT /api/sellers/account-profile` → `user.controller.updateProfile` (same as C1) | `avatars` | `User.avatar` | Public URL | Pub | Owner |
| S9 | Support ticket attachments | SW (`useTickets`), SA ([support.api.js:37,48](../mobile-seller/src/services/support.api.js#L37)) | as C5 | as C5 | `support-tickets` | as C5 | Public URL | **Priv** | as C5 |

### 3.3 Delivery partner (web portal only)

| ID | Feature | App | Route → controller | Folder | MongoDB field | Today | Vis |
|---|---|---|---|---|---|---|---|
| D1 | Driving licence | DW ([DeliveryContext.jsx:960](../frontend/src/modules/Delivery/context/DeliveryContext.jsx#L960)) | `PUT /api/delivery/step/1` → [deliveryPartner.controller.js:124](../backend/controllers/deliveryPartner.controller.js#L124) | `delivery-kyc/<userId>` | `DeliveryPartner.drivingLicense.url` | Public URL | **Priv-KYC** |
| D2 | Aadhaar front/back | DW ([:971](../frontend/src/modules/Delivery/context/DeliveryContext.jsx#L971)) | `PUT /api/delivery/step/2` → [:161-162](../backend/controllers/deliveryPartner.controller.js#L161-L162) | `delivery-kyc/<userId>` | `DeliveryPartner.aadhaar.frontUrl/backUrl` | Public URL | **Priv-KYC** |
| D3 | Bank passbook | DW ([:985](../frontend/src/modules/Delivery/context/DeliveryContext.jsx#L985)) | `PUT /api/delivery/step/3` → [:225](../backend/controllers/deliveryPartner.controller.js#L225) | `delivery-bank/<userId>` (**not** in sensitive list) | `DeliveryPartner.bankDetails.passbookUrl` | Public URL or silent unserved local disk | **Priv-KYC** |
| D4 | Support ticket attachments | DW ([DeliverySupportPage.jsx](../frontend/src/modules/Delivery/pages/DeliverySupportPage.jsx)) | as C5 | `support-tickets` | as C5 | Public URL | **Priv** |

Delivery partners have no avatar upload (profile page renders an initial).

### 3.4 Admin panel / CMS

| ID | Feature | Client | Route → controller | Folder | MongoDB field | Today | Vis |
|---|---|---|---|---|---|---|---|
| A1 | Banners (desktop/mobile image) | [BannersTab.jsx:191](../frontend/src/modules/Admin/components/BannersTab.jsx#L191) | `POST/PUT /api/banners` (`uploadBannerImage`, JPEG/PNG/WebP 5 MB) → [banner.controller.js:9](../backend/controllers/banner.controller.js#L9) | `banners` | `Banner.image`, `mobileImage` | Public URL | Pub when published |
| A2 | Storefront Studio images | [StorefrontMediaFields.jsx:35](../frontend/src/modules/Admin/components/StorefrontMediaFields.jsx#L35), [StorefrontStudio.jsx:163](../frontend/src/modules/Admin/components/StorefrontStudio.jsx#L163) | `POST /api/admin/storefront/media` → sharp re-encode to WebP → `uploadToCloudinary` | `storefront` | URL strings in `Banner.*`, `StorefrontExperience` config, theme header image | Public URL | Pub when published; drafts unlisted |
| A3 | Storefront Studio / hero / splash **video** | same | same route, direct `cloudinary.uploader.upload_stream` with transcoding; **no local fallback** | `nhcone/storefront` | `Banner.video`, `mobileVideo`, Studio config | Public URL | Pub |
| A4 | Category image + icon | [CategoriesTab.jsx:403,518,651](../frontend/src/modules/Admin/components/CategoriesTab.jsx#L403) | `POST/PUT /api/categories` → [category.controller.js:280,287,357,363](../backend/controllers/category.controller.js#L280) | `categories`, `category-icons` (SVG converted to PNG **by Cloudinary** via `format: 'png'`) | `Category.image`, `Category.icon` | Public URL | Pub |
| A5 | Campaign banner | [CampaignsTab.jsx:134](../frontend/src/modules/Admin/components/CampaignsTab.jsx#L134) | `POST/PATCH /api/admin/campaigns` → [campaign.controller.js:199,249](../backend/controllers/campaign.controller.js#L199) | `campaigns` | `Campaign.bannerImage` | Public URL | Pub |
| A6 | Push broadcast image | [NotificationBroadcasterTab.jsx:93](../frontend/src/modules/Admin/components/NotificationBroadcasterTab.jsx#L93) | `POST /api/admin/broadcasts` (`media`) → [broadcast.controller.js:23](../backend/controllers/broadcast.controller.js#L23) | `notifications` | `NotificationBroadcast.media.url` → fanned out to `Notification.media.url` and FCM `notification.image` | Public URL | **Pub (must be fetchable by FCM/Google without auth)** |
| A7 | Ticket replies / internal notes | admin tickets UI | `POST /api/admin/tickets/:id/messages`, `/notes` → [admin.controller.js:1954](../backend/controllers/admin.controller.js#L1954) | `support-tickets` | `TicketMessage.attachments` | Public URL | **Priv** (internal notes: admin-only) |
| A8 | KYC review (view only) | admin seller/rider dossiers | [admin.controller.js:177-183](../backend/controllers/admin.controller.js#L177-L183), [:951-955](../backend/controllers/admin.controller.js#L951-L955) return raw URLs | — | reads S4–S6, D1–D3 | Raw public URLs | Must become signed, audited views |

### 3.5 Dormant, legacy and tooling

| ID | Item | Status |
|---|---|---|
| X1 | Packaging materials/packages image upload ([packaging.controller.js:62,102,199,232](../backend/controllers/packaging.controller.js#L62)) | **Unrouted** — [packaging.routes.js](../backend/routes/packaging.routes.js) exports an empty router. Existing records keep Cloudinary URLs. Migrate data only. |
| X2 | `SellerPromotion.bannerImage` | Promotions retired. Data only. |
| X3 | `RationPackage.image`, `Order.returnImages`, `Admin.avatar`, `Seller.promoRequests[].url` | Fields with no current upload path. Data only. |
| X4 | Seed / maintenance scripts ([seedRealProducts.js:196](../backend/seed/seedRealProducts.js#L196), [cleanupAndUpdateProducts.js:74](../backend/scripts/cleanupAndUpdateProducts.js#L74), [checkCloudinary.js](../backend/seed/checkCloudinary.js)) | Dev tooling. Will follow the shared service automatically. |
| X5 | Tests referencing Cloudinary (≈14 in `backend/__tests__`, ≈8 in `backend/verification`, 3 in `frontend/verification`) | Need updating with the implementation; not run during this audit. |

## 4. Snapshot copies of media URLs (must not be rewritten)

These records store a *copy* of a media URL at a point in time. Section 16 of the brief forbids rewriting order/settlement records, so they keep their Cloudinary URLs permanently and must be handled by read-time resolution (see migration plan §5):

- `Order.items[].image` (product image at purchase)
- `Order.shippingAddress.landmarkImage`
- `Return.productImage`
- `Notification.media.url` (one per recipient)
- Cart line images, if persisted (`Cart` model references images)

**Consequence:** Cloudinary cannot be fully decommissioned (credentials revoked, account closed) unless either (a) a read-time URL map is in place for every response that returns these fields, or (b) the backend owner explicitly approves treating these historical images as acceptable losses.

## 5. Requested features that do not exist (not invented)

The brief lists these as examples. None exist in any client or backend route, so there is nothing to migrate:

- Delivery: pickup proof, delivery proof, customer handover photo, failed-delivery evidence, return-pickup photos, incident attachments, vehicle photos, RC, insurance, address proof, rider profile photo.
- Seller: variant-specific images, pickup-address / GPS photos, seller-side return evidence, product FAQ attachments, ad creatives (sponsored listings reuse product images), seller "documents" beyond PAN/trade licence.
- Customer: delivery-instruction attachments, feedback attachments outside tickets.
- Admin: brand logos, admin avatar upload, stored generated reports.
- SHG / CDS portals: no upload paths found; `Product.shgStoreId` folder naming is legacy.

If any of these are wanted (delivery proof photos especially), they are **new features** and need their own product decision; the new storage service will make them straightforward (category `delivery/delivery-proof` is reserved in the architecture).

## 6. Cross-cutting dependencies discovered

1. **Image search indexer** fetches catalogue images only from `https://res.cloudinary.com` plus `IMAGE_SEARCH_CATALOG_ORIGINS` ([imageSearchIndexer.service.js:15](../backend/services/imageSearchIndexer.service.js#L15)). Server-hosted product images will not be indexed unless the media origin is added (or the indexer reads from storage directly).
2. **FCM push images** (A6) must be reachable by Google over public HTTPS with no auth.
3. **Category SVG icons** depend on Cloudinary rasterisation to PNG.
4. **Storefront video** depends on Cloudinary transcoding.
5. **Deployment path naming:** [index.js:95](../backend/index.js#L95), [deploy.sh](../deploy.sh) and both storage services reference `forntend/`, while the repository directory is `frontend/`. Possibly a server-side rename; needs confirmation before any static-serving change.
6. **Hosting:** documentation refers to Hostinger with a `nodejs/` release directory that is replaced on deploy ([EBOOK_STORAGE.md](../EBOOK_STORAGE.md), [SERVICE_MANAGEMENT.md](../SERVICE_MANAGEMENT.md)). Disk persistence and capacity are **unverified** — this is the Section 15 gate (see infrastructure doc).
