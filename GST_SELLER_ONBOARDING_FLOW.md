# Seller GST assistance during registration

When a seller selects **No** for GSTIN and **Yes, Apply through Bulkimart**:

1. The assistance form opens within onboarding. Selecting the option does not submit a request or navigate away.
2. The seller supplies a contact name, optional message and explicit consent. Existing business details are reused.
3. **Continue to Review** is available even when KYC uploads or PAN are missing. The review page lists missing Aadhaar front/back, bank passbook/cancelled cheque, PAN or GST details. The seller can return to complete them; final submission requires all of these.
4. The review screen confirms that GST assistance will be submitted with the seller application and reviewed separately.
5. **Submit for Verification** saves the seller onboarding details, creates a single pending GST assistance request and submits the seller application for review. The request and seller document-step update use one transaction.
6. Registration can finish while GST assistance is pending. The submitted page shows the assistance status. Seller approval and GST assistance review remain separate.

The seller dashboard checks `GET /api/sellers/gst-assistance/me` automatically. When no request has been submitted, it returns HTTP 200 with `data: null`, and the optional assistance panel stays hidden. This empty state creates no request or payment. Missing admin records, documents and action targets still return errors; real endpoint failures remain visible in the UI.

## Dynamic service fee and vendor payment

The initial total service fee is ₹100, saved in the configured database. There is no ₹100 fallback in the application code.

- Change it at **Admin -> GST Registration Assistance -> GST service fee settings**. Enter the total fee in rupees and the payment/cancellation terms. Saving requires seller-management access plus finance permission, or a super-admin account. Version checks prevent overwriting concurrent edits and fee edits retain an audit history.
- The onboarding assistance form reads and displays the configured fee. A new request snapshots that price and its terms; subsequent admin edits apply to new requests, preserving existing request prices.
- After registration submission, the vendor sees **Pay ₹<fee> to Bulkimart** in **GST Registration Assistance** on the application status page or seller dashboard. The vendor explicitly accepts the displayed fee and terms before Razorpay checkout opens.
- The backend verifies the Razorpay signature, gateway order, captured amount, currency, request ownership and payment environment. Browser checkout success alone does not mark the request paid. Webhooks and **Check payment status** recover closed/interrupted checkouts.
- Checkout initialization is persisted before contacting the gateway. Repeated/concurrent clicks reuse the existing checkout; uncertain creation is reconciled before another order can be created.
- Verified collections use a separate held GST service ledger account; they do not increase seller payable earnings. Refunds and disputes require review. Provider-verified refunds are reflected as compensating ledger entries. This change does not automatically execute refunds or recognize revenue.
- Assistance cannot be approved for work or completed while its fee is unpaid or under financial review. Seller registration submission remains independent of payment.

Local payment mode remains Razorpay **test**. No real vendor payment was executed during verification. Production needs the correct live gateway configuration and deployed code; no live deployment was performed.

Local `backend/.env` now has `GST_ASSISTANCE_ENABLED=true`; the running capability endpoint confirmed `enabled: true`.

The screenshot is from `bulkimart.in`. To enable the same flow there, deploy the updated backend/frontend and configure the deployed backend with:

```dotenv
GST_ASSISTANCE_ENABLED=true
GST_ASSISTANCE_PRODUCTION_ENABLED=true
```

Restart/redeploy the backend after setting these. The production flag is an explicit opt-in for GST assistance request intake; other services' production restrictions are unchanged. No live deployment was performed as part of this change.

An unavailable capability disables the assistance option while retaining the choice to continue without GST. A failed capability check now has a distinct retry state. The form also explains the required contact name and consent when these prevent continuing.

This requests Bulkimart assistance; it does not file a government application or guarantee a GSTIN. Completing seller registration does not itself grant approval to sell.

Validation: frontend and backend builds passed. GST API tests (37) and parcel regression tests (73) passed, with additional legal, advertising and finance regression suites passing. Frontend GST/payment checks (24) passed. A headless browser checked six mobile/desktop views for review with missing KYC, admin fee edits and simulated vendor checkout. Tests cover ownership, permissions, price snapshots, mismatched amounts/signatures, duplicate initialization, uncertain checkout recovery and late-capture/refund review.
