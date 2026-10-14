# E-book commerce implementation audit and plan

## Audit (2026-10-14)

- Seller e-book creation already uses `Product.fulfillmentType = digital`, a pending moderation state, a Cloudinary cover image, and a separate authenticated `POST /api/products/:id/digital-file` upload.
- Original PDFs are already written by `backend/services/ebookStorage.service.js` to `EBOOK_STORAGE_DIR` (default `backend/private-data/ebooks`) with UUID filenames, restrictive modes, PDF header/MIME/extension validation, SHA-256 metadata, and no Express static mount.
- Customer commerce is disabled intentionally by explicit digital exclusions in `product.controller.js`, `cart.controller.js`, and `order.controller.js`. There was no entitlement model, library endpoint, or authenticated download stream.
- Razorpay order creation, signature verification, live payment reconciliation, raw-body webhook verification, and idempotent payment settlement already exist and are reused.
- PhonePe customer order initiation, callback/webhook routes, mock UI, wallet top-up copy, and fallback selection were active. Historical `Payment.gateway.provider` and PhonePe refund fields must remain readable.
- The existing order model assumes physical fulfillment. This implementation permits digital-only checkout and rejects a mixed physical/digital checkout with an actionable separation message; it never charges a digital line a delivery fee.
- No deployment manifest proves that the configured host volume is persistent. Production activation therefore requires an absolute `EBOOK_STORAGE_DIR` on a backed-up persistent mount shared by every backend instance.

## File-level implementation plan

1. Harden storage reads and integrity checks in `backend/services/ebookStorage.service.js`.
2. Add `DigitalEntitlement` and `DigitalDownloadAudit` models with idempotency indexes.
3. Add digital-only checkout, paid-entitlement activation, library, and secure streaming controllers/routes.
4. Expose approved e-books through sanitized public product APIs; allow quantity-one digital cart lines while retaining physical inventory behavior.
5. Make Razorpay the sole customer order gateway and remove customer PhonePe callback/mock UI paths without rewriting historical payments.
6. Add the customer Digital Library and digital-aware product/cart/checkout presentation.
7. Add focused storage, authorization, cart, checkout, payment, and entitlement tests; run backend tests and the frontend production build.

## Guarded decisions

- Refund/chargeback entitlement revocation is not automatically enabled because the business access policy is unspecified. Entitlements retain an auditable status field for the approved policy later.
- Existing external PDF references are not migrated or deleted. A production inventory and verified backup are required before any separate migration.
- No production database, filesystem migration, charge, refund, or deployment is performed by this change.
