# E-book foundation (Phase 1)

E-books are represented additively on `Product`: `fulfillmentType` is `physical` (legacy/default) or `digital`; `digital` contains author, language, PDF format, optional license terms, and private upload metadata. The ordinary `type` remains the existing `ecommerce` channel. Existing product variants and retail fields are unchanged. Digital listings use one priced variant with zero stock as a schema-compatible price carrier; that zero is not physical inventory and is never available to cart/checkout.

Seller listing flow: create a pending/inactive e-book draft with its cover image through the existing Cloudinary image route, then upload the actual PDF to `POST /api/products/:id/digital-file`. The endpoint requires an authenticated, approved seller and verifies product ownership. Metadata edits preserve the current file. Replacing a file returns the listing to pending moderation. Admin approval checks required metadata, file record association/integrity metadata, and active approved seller status. Product response serializers and public product feeds never reveal e-books or private file IDs. No download endpoint, entitlement, cart, checkout, order, or payment access exists in this phase.

## Local storage

Set `EBOOK_STORAGE_DIR` to an absolute writable directory for local development. If unset, the backend uses `backend/private-data/ebooks/` relative to this repository's backend source. The folder is created on first successful upload with restrictive directory/file modes, is ignored by Git, is outside the frontend build, and is not mounted by Express static middleware. `EBOOK_MAX_UPLOAD_BYTES` optionally sets the upload cap (default 25 MiB; 1–250 MiB accepted). Only PDF is supported; EPUB is deferred until equivalent format validation and secure delivery are designed. Cloudinary continues to receive only cover/product images.

The upload uses an unpredictable UUID filename, exclusive file creation, PDF extension + MIME + signature checks, bounded in-memory upload, SHA-256 metadata, and path containment validation. No original filename, filesystem path, or permanent URL is stored in the product record. Failed persistence removes the newly written file; failed replacement preserves the prior file. There is deliberately no file-serving route. Product deletion can leave an orphaned private file; safe orphan reconciliation is a separate reviewed maintenance task, not an automatic destructive startup action.

## Deployment and later access

At deployment, set `EBOOK_STORAGE_DIR` to a private persistent mounted volume, ensure the service account can create/read/delete files but public web users cannot access that directory, monitor capacity, and include it in encrypted backups with tested restore procedures. Do not assume a provider's local disk persists across restarts, deploys, or instances; verify the chosen host's filesystem semantics before launch. For multiple backend instances, all instances need the same durable storage or a later storage adapter. A future volume move should use a manifest/checksum-based copy, verify every file, switch configuration, and retain rollback copies until access checks pass.

Before digital checkout/download launch, design a server-verified entitlement tied to customer + paid order line + product/file version; enforce payment success, ownership, cancellation/refund/chargeback revocation, product/file availability, and seller/admin management authorization. Deliver only through an authenticated streaming endpoint or short-lived signed URL, with safe content-disposition, `nosniff`, private/no-store cache controls, range/abuse limits, and audit logging. A frontend success page is never proof of entitlement.

## Fulfillment and finance decisions still required

Digital-only checkout should be implemented first. Reject mixed physical/digital carts until shipping, taxes, partial refunds, coupon allocation, and split settlement rules are approved. Digital items must not consume inventory, require a shipping address, create courier assignment/delivery OTP, or enter physical restocking automatically. Preserve order snapshots and existing physical workflows.

Business approval is still needed for seller commission/platform fees, tax and invoice classification, coupons, referral qualifying-order eligibility, refund/chargeback policy and access revocation, seller settlement timing, and license/usage terms. No values or policies are inferred here. The known Referral Program post-credit chargeback reward-reversal gap remains unchanged and should be addressed separately. Generic Donations & Social Impact remains unchanged.

## Rollout prerequisites

No database migration or index is required by this foundation; the embedded fields are additive and legacy records resolve to physical. No migration has been executed. Before enabling digital listings in production, deploy backend schema/code and private volume configuration, verify permissions/backups/capacity, then deploy the seller UI and admin moderation. Monitor uploads and orphan counts. Do not enable customer catalog exposure, purchasing, or paid downloads until entitlement, mixed-cart policy, financial rules, file scanning/abuse controls, and durable multi-instance storage are reviewed and tested.
