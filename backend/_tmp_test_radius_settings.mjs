import 'dotenv/config';
import { setServers } from 'dns';
if (process.env.NODE_ENV !== 'production') setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
import mongoose from 'mongoose';
import RadiusSetting from './models/RadiusSetting.js';
import Seller from './models/Seller.js';
import DeliveryPartner from './models/DeliveryPartner.js';
import {
  getRadiusSettingForAdmin, setRadiusSettingForAdmin,
  setSellerRadius, setDeliveryPartnerRadius,
} from './controllers/admin.controller.js';
import { getMySellerProfile } from './controllers/seller.controller.js';
import { checkSameDayEligibility } from './services/sameDay.service.js';
import { getRadiusSetting, loadRadiusSetting, invalidateRadiusSetting } from './services/radiusSetting.service.js';
import {
  SAME_DAY_MAX_RADIUS_KM, SELLER_SERVICE_MAX_RADIUS_KM, DELIVERY_PARTNER_MAX_RADIUS_KM,
} from './constants/enums.js';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

function mockRes() {
  let resolveDone;
  const res = { statusCode: 200, done: new Promise((r) => { resolveDone = r; }) };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; resolveDone(); return res; };
  return res;
}
const next = (res) => (err) => { if (err) res.status(err.status || err.statusCode || 500).json({ message: err.message }); };
const call = async (fn, req) => { const res = mockRes(); fn(req, res, next(res)); await res.done; return res; };

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  // Preserve whatever real config exists so this run doesn't clobber it.
  const preexistingActive = await RadiusSetting.findOne({ isActive: true }).lean();

  // ============================================================
  // 1. DEFAULTS — no active RadiusSetting -> env/hardcoded fallback
  // ============================================================
  await RadiusSetting.updateMany({ isActive: true }, { $set: { isActive: false } });
  invalidateRadiusSetting();
  await loadRadiusSetting();
  {
    const live = getRadiusSetting();
    check('1. default: sameDay ceiling = env default', live.sameDayMaxRadiusKm === SAME_DAY_MAX_RADIUS_KM);
    check('1. default: seller ceiling = env default', live.sellerServiceMaxRadiusKm === SELLER_SERVICE_MAX_RADIUS_KM);
    check('1. default: partner ceiling = env default', live.deliveryPartnerMaxRadiusKm === DELIVERY_PARTNER_MAX_RADIUS_KM);
  }
  {
    const r = await call(getRadiusSettingForAdmin, {});
    check('1. admin GET when unconfigured: 200', r.statusCode === 200);
    check('1. admin GET when unconfigured: source=default', r.body?.data?.current?.source === 'default');
  }

  // ============================================================
  // 7-13. VALIDATION
  // ============================================================
  const admin = { _id: new mongoose.Types.ObjectId() };
  const base = { sameDayMaxRadiusKm: 15, sellerServiceMaxRadiusKm: 40, deliveryPartnerMaxRadiusKm: 35 };
  const post = (body) => call(setRadiusSettingForAdmin, { user: admin, body });

  { const r = await post({ ...base, sameDayMaxRadiusKm: -1 });  check('7. negative rejected: 400', r.statusCode === 400); }
  { const r = await post({ ...base, sameDayMaxRadiusKm: 0 });   check('8. zero rejected: 400', r.statusCode === 400); }
  { const r = await post({ ...base, sameDayMaxRadiusKm: NaN }); check('9. NaN rejected: 400', r.statusCode === 400); }
  { const r = await post({ ...base, sameDayMaxRadiusKm: Infinity }); check('10. Infinity rejected: 400', r.statusCode === 400); }
  { const r = await post({ ...base, sameDayMaxRadiusKm: 'abc' }); check('11. string rejected: 400', r.statusCode === 400); }
  { const r = await post({ sellerServiceMaxRadiusKm: 40, deliveryPartnerMaxRadiusKm: 35 }); check('12. missing field rejected: 400', r.statusCode === 400); }
  { const r = await post({ ...base, sameDayMaxRadiusKm: 101 }); check('13. >100 rejected: 400', r.statusCode === 400); }

  // ============================================================
  // 2-6. ADMIN CREATE / HISTORY / SINGLE-ACTIVE
  // ============================================================
  let firstCreatedId;
  {
    const r = await post(base);
    check('3. admin POST creates active: 200', r.statusCode === 200);
    check('3. created isActive true', r.body?.data?.isActive === true);
    firstCreatedId = r.body?.data?._id;
  }
  {
    const r = await call(getRadiusSettingForAdmin, {});
    check('2. admin GET returns current: matches', r.body?.data?.current?.sameDayMaxRadiusKm === 15);
    check('2. admin GET returns history: length >= 1', (r.body?.data?.history?.length || 0) >= 1);
  }

  const second = { sameDayMaxRadiusKm: 10, sellerServiceMaxRadiusKm: 30, deliveryPartnerMaxRadiusKm: 25, note: 'lowered for test' };
  { const r = await post(second); check('4. second POST creates new active: 200', r.statusCode === 200); }

  {
    const activeCount = await RadiusSetting.countDocuments({ isActive: true });
    check('6. exactly one active row after update', activeCount === 1);
    const firstRow = await RadiusSetting.findById(firstCreatedId);
    check('4. previous row became inactive', firstRow.isActive === false);
    const historyCount = await RadiusSetting.countDocuments({});
    check('5. history preserved (>=2 rows)', historyCount >= 2);
  }

  // ============================================================
  // 28-29. CACHE — invalidated + fresh immediately, no restart
  // ============================================================
  {
    const live = getRadiusSetting();
    check('28/29. cache reflects the just-saved value with no restart', live.sameDayMaxRadiusKm === 10 && live.sellerServiceMaxRadiusKm === 30 && live.deliveryPartnerMaxRadiusKm === 25);
  }

  // ============================================================
  // 14-18. SAME-DAY — dynamic ceiling participates in the live Math.min clamp
  // ============================================================
  const shop = { lat: 22.7196, lng: 75.8577 };
  // ~9km north of the shop — between the lowered ceiling (5) and the higher one (10).
  const midDestination = { lat: 22.7196 + 0.081, lng: 75.8577 };
  const sellerFixture = (radiusKm) => ({
    status: 'approved',
    storeDetails: { lat: shop.lat, lng: shop.lng },
    sameDay: { enabled: true, radiusKm, cutoffTime: '23:59', availableDays: [] },
  });
  const productFixture = { sameDay: { enabled: true }, type: 'ecommerce', stock: 10 };

  {
    // Seller's own radius (50) is far above the ceiling (10) — ceiling must win via Math.min.
    const res = await checkSameDayEligibility({ product: productFixture, seller: sellerFixture(50), destination: midDestination });
    check('14/16. ~9km within dynamic ceiling (10): eligible', res.available === true);
  }
  {
    // Lower the ceiling below 9km and confirm the very next check (no restart) reflects it.
    await post({ sameDayMaxRadiusKm: 5, sellerServiceMaxRadiusKm: 30, deliveryPartnerMaxRadiusKm: 25 });
    const res = await checkSameDayEligibility({ product: productFixture, seller: sellerFixture(50), destination: midDestination });
    check('17/18. ceiling lowered to 5 -> same ~9km trip now TOO_FAR, no restart', res.available === false && res.code === 'TOO_FAR');
  }
  {
    // Restore ceiling to 10 for the rest of the run, and confirm a seller radius NARROWER than the ceiling still wins (seller can't be widened by the ceiling).
    await post({ sameDayMaxRadiusKm: 10, sellerServiceMaxRadiusKm: 30, deliveryPartnerMaxRadiusKm: 25 });
    const res = await checkSameDayEligibility({ product: productFixture, seller: sellerFixture(3), destination: midDestination });
    check('15. seller radius (3km) narrower than ceiling (10km): still governs, TOO_FAR', res.available === false && res.code === 'TOO_FAR');
  }

  // ============================================================
  // 19-22. SELLER — setSellerRadius uses the dynamic ceiling
  // ============================================================
  const seller = await Seller.findOne();
  if (seller) {
    const originalRadius = seller.serviceRadiusKm;

    // Current dynamic ceiling is 30. 35 is above the NEW ceiling but below the
    // OLD static env default (50) — only rejected if the dynamic value is actually read.
    { const r = await call(setSellerRadius, { params: { id: seller._id }, body: { radiusKm: 35 } });
      check('21. seller radius above DYNAMIC ceiling (30) rejected: 400', r.statusCode === 400); }
    { const r = await call(setSellerRadius, { params: { id: seller._id }, body: { radiusKm: 20 } });
      check('19/22. seller radius under dynamic ceiling accepted: 200', r.statusCode === 200);
      check('22. saved as 20', r.body?.data?.serviceRadiusKm === 20); }

    // Lowering the global ceiling further must NOT silently mutate the stored value.
    await post({ sameDayMaxRadiusKm: 10, sellerServiceMaxRadiusKm: 15, deliveryPartnerMaxRadiusKm: 25 });
    {
      const fresh = await Seller.findById(seller._id);
      check('20. lowering global ceiling does not mutate stored seller radius', fresh.serviceRadiusKm === 20);
    }

    // restore
    await Seller.updateOne({ _id: seller._id }, originalRadius === undefined
      ? { $unset: { serviceRadiusKm: '' } }
      : { $set: { serviceRadiusKm: originalRadius } });
  } else {
    console.log('(no seller in DB — skipping seller radius dynamic-ceiling checks)');
  }

  // restore seller ceiling to something workable for later checks
  await post({ sameDayMaxRadiusKm: 10, sellerServiceMaxRadiusKm: 30, deliveryPartnerMaxRadiusKm: 25 });

  // ============================================================
  // 23-26. DELIVERY PARTNER — setDeliveryPartnerRadius uses the dynamic ceiling
  // ============================================================
  const partner = await DeliveryPartner.findOne();
  if (partner) {
    const originalRadius = partner.deliveryRadiusKm;

    // Dynamic ceiling is 25. 28 is above it but below the OLD static default (50).
    { const r = await call(setDeliveryPartnerRadius, { params: { id: partner._id }, body: { radiusKm: 28 } });
      check('25. partner radius above DYNAMIC ceiling (25) rejected: 400', r.statusCode === 400); }
    { const r = await call(setDeliveryPartnerRadius, { params: { id: partner._id }, body: { radiusKm: 15 } });
      check('23/26. partner radius under dynamic ceiling accepted: 200', r.statusCode === 200);
      check('26. saved as 15', r.body?.data?.deliveryRadiusKm === 15); }

    await post({ sameDayMaxRadiusKm: 10, sellerServiceMaxRadiusKm: 30, deliveryPartnerMaxRadiusKm: 12 });
    {
      const fresh = await DeliveryPartner.findById(partner._id);
      check('24. lowering global ceiling does not mutate stored partner radius', fresh.deliveryRadiusKm === 15);
    }

    await DeliveryPartner.updateOne({ _id: partner._id }, originalRadius === undefined
      ? { $unset: { deliveryRadiusKm: '' } }
      : { $set: { deliveryRadiusKm: originalRadius } });
  } else {
    console.log('(no delivery partner in DB — skipping partner radius dynamic-ceiling checks)');
  }

  // ============================================================
  // 27. SELLER-FACING API reflects the dynamic ceiling
  // ============================================================
  if (seller) {
    await post({ sameDayMaxRadiusKm: 17, sellerServiceMaxRadiusKm: 30, deliveryPartnerMaxRadiusKm: 25 });
    const r = await call(getMySellerProfile, { user: { _id: seller.userId } });
    check('27. seller-facing sameDayMaxRadiusKm reflects dynamic setting', r.body?.limits?.sameDayMaxRadiusKm === 17);
  }

  // ============================================================
  // 33-34. HISTORY across multiple updates
  // ============================================================
  {
    const countBefore = await RadiusSetting.countDocuments({});
    await post({ sameDayMaxRadiusKm: 18, sellerServiceMaxRadiusKm: 31, deliveryPartnerMaxRadiusKm: 26 });
    await post({ sameDayMaxRadiusKm: 19, sellerServiceMaxRadiusKm: 32, deliveryPartnerMaxRadiusKm: 27 });
    const countAfter = await RadiusSetting.countDocuments({});
    check('33. multiple updates preserve all previous records', countAfter === countBefore + 2);
    const activeCount = await RadiusSetting.countDocuments({ isActive: true });
    check('34. exactly one active record after each update', activeCount === 1);
  }

  // ============================================================
  // restore whatever was active before this run touched anything
  // ============================================================
  await RadiusSetting.updateMany({ isActive: true }, { $set: { isActive: false } });
  if (preexistingActive) {
    await RadiusSetting.updateOne({ _id: preexistingActive._id }, { $set: { isActive: true } });
  }
  invalidateRadiusSetting();
  await loadRadiusSetting();

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
