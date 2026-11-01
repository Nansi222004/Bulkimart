# MEMORY — mobile-delivery

Facts a future session needs. Keep short.

- 2026-11-01: app source written from the web portal (`frontend/src/modules/Delivery`). Never built or run: the dev machine failed the security gate (runtimedev-link malware files still present). Do not run npm/Gradle on that machine.
- Versions mirror `mobile-seller` (RN 0.88.1, React 19.3.0, React Navigation 7). `package-lock.json` does not exist yet; create it on a clean machine.
- Staging URL unknown → `src/config/env.js` staging `apiBaseUrl: null` → debug builds block all API calls by design.
- COD: show server `codAmount` (already rounded, backend `codCashDuePaise`); app requires exact whole-rupee cash. Backend still completes COD orders with a wrong amount (finding S2, owner decision pending).
- Offer window 60 s is client-side only (server sends no expiry for forward offers), same as web.
- Rider routes need `requireApprovedPartner`; onboarding routes only `protect`. Approved/suspended riders cannot edit KYC/bank (server `assertEditable`).
- Parcel driver API is `/api/delivery/parcels/*`; production parcel mutations are release-blocked server-side.
- Web fixes made alongside: missing `useMemo` import (DeliveryContext), false "Online" toast (Dashboard), suspended rider kept dashboard (refreshRiderStatus).
