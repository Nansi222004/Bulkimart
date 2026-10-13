import Seller from '../models/Seller.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import Notification from '../models/Notification.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { uploadToCloudinary } from '../services/cloudinary.service.js';
import {
  CHANNEL, CHANNELS, LOW_STOCK_THRESHOLD, ORDER_STATUS, vendorTransitions, VENDOR_CANCELLABLE_STATUSES,
  SAME_DAY_MAX_PROCESSING_MINUTES, WHOLESALE_CHANNEL, WHOLESALE_REQUEST_STATUS,
} from '../constants/enums.js';
import { parseLocation } from '../utils/geo.js';
import { parseSellerSameDay } from '../services/sameDay.service.js';
import { getRadiusSetting } from '../services/radiusSetting.service.js';
import { notifyUser, NOTIFICATION_EVENT } from '../services/notification.service.js';
import { httpError } from '../utils/response.js';

// Helper to notify admins
const notifyAdmins = async (title, message) => {
  try {
    // In real app, find admin users and create Notifications for them
    console.log(`[ADMIN NOTIFICATION] Title: ${title} | Message: ${message}`);
  } catch (e) {
    console.error('Error notifying admins:', e);
  }
};

// @desc    Start seller onboarding
// @route   POST /api/sellers/start
// @access  Private
export const startOnboarding = asyncHandler(async (req, res) => {
  const hasChannelSelection = Object.prototype.hasOwnProperty.call(req.body || {}, 'salesChannels');
  let requestedChannels;
  if (hasChannelSelection) {
    const { salesChannels } = req.body;
    const allowedChannels = [CHANNEL.ECOM, CHANNEL.GROCERY];
    if (!Array.isArray(salesChannels) || salesChannels.length === 0 || salesChannels.some((channel) => !allowedChannels.includes(channel))) {
      throw httpError(400, 'salesChannels must contain ecommerce, grocery, or both');
    }
    requestedChannels = [...new Set(salesChannels)];
  }

  let seller = await Seller.findOne({ userId: req.user._id });
  let channelSelectionDefaulted = false;
  if (!seller) {
    seller = await Seller.create({
      userId: req.user._id,
      phone: req.user.phone,
      onboardingStep: 1,
      status: 'incomplete',
      salesChannels: requestedChannels || [CHANNEL.ECOM],
    });
    channelSelectionDefaulted = !hasChannelSelection;
    requestedChannels = null; // already persisted by Seller.create
  } else if (requestedChannels) {
    const currentChannels = Array.isArray(seller.salesChannels) ? [...new Set(seller.salesChannels)] : [];
    const sameSelection = currentChannels.length === requestedChannels.length &&
      currentChannels.every((channel) => requestedChannels.includes(channel));
    if (seller.status !== 'incomplete' && !sameSelection) {
      throw httpError(409, 'Sales channels can only be selected during initial onboarding');
    }
    if (seller.status !== 'incomplete') requestedChannels = null;
  }

  if (seller && requestedChannels) {
    seller.salesChannels = requestedChannels;
    await seller.save();
  } else if (seller && (!Array.isArray(seller.salesChannels) || seller.salesChannels.length === 0)) {
    // Legacy clients did not send channels. Preserve their established default,
    // but make the fallback explicit in the response rather than silently
    // misclassifying a submitted Quick/Hybrid selection.
    seller.salesChannels = [CHANNEL.ECOM];
    await seller.save();
    channelSelectionDefaulted = true;
  }

  // Link the profile, but DO NOT grant the 'seller' role here.
  // The role is what unlocks the seller panel, so it is granted only when an
  // admin approves the application (see admin.controller.js approveSeller).
  // Registering must never by itself hand out panel access.
  await User.updateOne({ _id: req.user._id }, { $set: { sellerId: seller._id } });

  res.status(200).json({
    success: true,
    seller,
    salesChannels: seller.salesChannels,
    channelSelectionDefaulted,
  });
});

// @desc    Step 1: Business info
// @route   PUT /api/sellers/step/1
// @access  Private
export const submitStep1 = asyncHandler(async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user._id });
  if (!seller) {
    res.status(404);
    throw new Error('Seller profile not initiated');
  }

  const { businessName, businessType, storeDetails } = req.body;
  if (!businessName || !businessType || !storeDetails) {
    res.status(400);
    throw new Error('Please fill all fields');
  }

  /**
   * The store's position, validated the same way a rider's is.
   *
   * Quick Commerce cannot function without it: a shopper is shown stores within
   * range of them, and a rider is rung for pickups near where they are. A store
   * with no coordinates is invisible to both, so this is required rather than
   * optional — but either a GPS fix or a typed address with a pincode satisfies
   * it, so nobody is blocked by a denied permission prompt.
   */
  const parsed = parseLocation(storeDetails);
  if (!parsed.ok) {
    res.status(400);
    throw new Error(parsed.message);
  }

  const loc = parsed.location;
  const hasCoords = loc.lat !== undefined && loc.lng !== undefined;
  if (!hasCoords && !loc.pincode) {
    res.status(400);
    throw new Error('Pin your store on the map, or enter its 6-digit pincode');
  }

  seller.businessName = businessName;
  seller.businessType = businessType;

  // Merge, so editing only the store name does not wipe coordinates captured on
  // an earlier pass through this step.
  seller.storeDetails = {
    ...(seller.storeDetails?.toObject?.() ?? seller.storeDetails ?? {}),
    ...storeDetails,
    ...(hasCoords
      ? { lat: loc.lat, lng: loc.lng, point: loc.point, locationSource: loc.source }
      : {}),
    ...(loc.pincode ? { pincode: loc.pincode } : {}),
  };
  
  if (seller.onboardingStep < 2) {
    seller.onboardingStep = 2;
  }

  await seller.save();
  res.status(200).json({ success: true, seller });
});

// @desc    Step 2: Aadhaar upload
// @route   PUT /api/sellers/step/2
// @access  Private
export const submitStep2 = asyncHandler(async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user._id });
  if (!seller) {
    res.status(404);
    throw new Error('Seller profile not initiated');
  }

  const { aadhaarNumber } = req.body;
  if (!aadhaarNumber) {
    res.status(400);
    throw new Error('Please provide Aadhaar number');
  }

  if (!req.files || !req.files.aadhaarFront || !req.files.aadhaarBack) {
    res.status(400);
    throw new Error('Please upload Aadhaar front and back documents');
  }

  const frontUrl = await uploadToCloudinary(req.files.aadhaarFront[0].buffer, `seller-kyc/${req.user._id}`);
  const backUrl = await uploadToCloudinary(req.files.aadhaarBack[0].buffer, `seller-kyc/${req.user._id}`);

  seller.aadhaar = {
    number: `XXXX-XXXX-${aadhaarNumber.slice(-4)}`,
    frontUrl,
    backUrl
  };

  if (seller.onboardingStep < 3) {
    seller.onboardingStep = 3;
  }

  await seller.save();
  res.status(200).json({ success: true, seller });
});

// @desc    Step 3: Bank Details
// @route   PUT /api/sellers/step/3
// @access  Private
export const submitStep3 = asyncHandler(async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user._id });
  if (!seller) {
    res.status(404);
    throw new Error('Seller profile not initiated');
  }

  const { accountNo, ifsc, holderName, bankName, upiId } = req.body;
  if (!accountNo || !ifsc || !holderName || !bankName) {
    res.status(400);
    throw new Error('Please fill all bank fields');
  }

  if (!req.file) {
    res.status(400);
    throw new Error('Please upload passbook or cancelled cheque document');
  }

  const passbookUrl = await uploadToCloudinary(req.file.buffer, `seller-bank/${req.user._id}`);

  seller.bankDetails = {
    accountNo,
    ifsc,
    holderName,
    bankName,
    upiId,
    passbookUrl
  };

  if (seller.onboardingStep < 4) {
    seller.onboardingStep = 4;
  }

  await seller.save();
  res.status(200).json({ success: true, seller });
});

// @desc    Step 4: Documents upload
// @route   PUT /api/sellers/step/4
// @access  Private
export const submitStep4 = asyncHandler(async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user._id });
  if (!seller) {
    res.status(404);
    throw new Error('Seller profile not initiated');
  }

  const { gstin, pan, fssai, tradeLicense } = req.body;
  if (!pan) {
    res.status(400);
    throw new Error('PAN number is required');
  }

  seller.gstin = gstin;
  seller.pan = pan;
  seller.fssai = fssai;
  seller.tradeLicense = tradeLicense;

  if (req.files) {
    const uploadedDocs = [];
    for (const [key, files] of Object.entries(req.files)) {
      const file = files[0];
      const url = await uploadToCloudinary(file.buffer, `seller-docs/${req.user._id}`);
      uploadedDocs.push({ type: key, url, uploadedAt: new Date() });
    }
    seller.documents = seller.documents.concat(uploadedDocs);
  }

  if (seller.onboardingStep < 5) {
    seller.onboardingStep = 5;
  }

  await seller.save();
  res.status(200).json({ success: true, seller });
});

// @desc    Submit application for review
// @route   POST /api/sellers/submit
// @access  Private
export const submitApplication = asyncHandler(async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user._id });
  if (!seller) {
    res.status(404);
    throw new Error('Seller profile not found');
  }

  if (seller.onboardingStep < 5) {
    res.status(400);
    throw new Error('Please complete all onboarding steps first');
  }

  seller.status = 'pending';
  await seller.save();

  await notifyAdmins('New Seller Onboarding Application', `Seller "${seller.businessName}" has submitted KYC for approval.`);

  res.status(200).json({
    success: true,
    message: 'Application submitted for admin review successfully',
    seller
  });
});

// @desc    Get current seller profile status
// @route   GET /api/sellers/me
// @access  Private
export const getMySellerProfile = asyncHandler(async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user._id }).populate('userId', 'name phone email avatar');
  if (!seller) {
    res.status(404);
    throw new Error('Seller profile not found');
  }

  res.status(200).json({
    success: true,
    seller,
    /**
     * The platform's ceilings, sent rather than hardcoded in the panel.
     *
     * The seller form needs these to validate as somebody types, and a second
     * copy living in the frontend is a copy that drifts — this codebase has
     * already paid for that with claimable statuses, the payout formula, the DNS
     * fix and address parsing. The server stays the authority; this is only so
     * the form can say "no more than 20 km" without guessing what 20 is.
     */
    limits: {
      sameDayMaxRadiusKm: getRadiusSetting().sameDayMaxRadiusKm,
      sameDayMaxProcessingMinutes: SAME_DAY_MAX_PROCESSING_MINUTES,
    },
  });
});

// @desc    Update store logo or banner details
// @route   PUT /api/sellers/profile
// @access  Private
export const updateStoreProfile = asyncHandler(async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user._id });
  if (!seller) {
    res.status(404);
    throw new Error('Seller profile not found');
  }

  const { name, description, address, phone, lat, lng, city, state, pincode, sameDay } = req.body;

  /**
   * The shop's Same-Day hours and reach.
   *
   * Kept on the seller rather than repeated on every listing, so closing
   * Same-Day for a week is one change instead of one per product. Guarded on
   * `!== undefined` because switching it off is an edit that has to be saved;
   * a profile update that says nothing about Same-Day leaves it untouched.
   *
   * The radius ceiling is checked in the parser for a readable message and again
   * by the schema, which is the check that cannot be talked around.
   */
  if (sameDay !== undefined) {
    seller.sameDay = parseSellerSameDay(sameDay, seller.sameDay);
  }

  if (name) seller.storeDetails.name = name;
  if (description) seller.storeDetails.description = description;
  if (address) seller.storeDetails.address = address;
  if (phone) seller.storeDetails.phone = phone;
  if (city) seller.storeDetails.city = city;
  if (state) seller.storeDetails.state = state;
  if (pincode) seller.storeDetails.pincode = pincode;

  if (lat !== undefined && lng !== undefined) {
    seller.storeDetails.lat = parseFloat(lat);
    seller.storeDetails.lng = parseFloat(lng);
    seller.storeDetails.point = { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] };
    seller.storeDetails.locationSource = 'gps';
    // Force mongoose to notice the change in the nested object
    seller.markModified('storeDetails');
  }

  if (req.files) {
    if (req.files.logo) {
      seller.storeDetails.logo = await uploadToCloudinary(req.files.logo[0].buffer, `seller-branding/${req.user._id}`);
    }
    if (req.files.banner) {
      seller.storeDetails.banner = await uploadToCloudinary(req.files.banner[0].buffer, `seller-branding/${req.user._id}`);
    }
  }

  await seller.save();

  // Keep every one of this seller's products' denormalized `sellerName` in
  // sync — see Product.js's field comment. A no-op query (matches nothing)
  // when this seller has no products yet or didn't rename their shop.
  if (name) {
    await Product.updateMany({ sellerId: seller._id }, { $set: { sellerName: seller.storeDetails.name } });
  }

  res.status(200).json({
    success: true,
    seller
  });
});

// @desc    Get dashboard metrics
// @route   GET /api/sellers/dashboard
// @access  Private
export const getDashboard = asyncHandler(async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user._id });
  if (!seller) {
    res.status(404);
    throw new Error('Seller profile not found');
  }

  // The seller panel has a Shop All / Quick toggle. ?type= scopes every counter
  // to the active channel, so switching the toggle changes the numbers while the
  // layout stays identical.
  const channel = CHANNELS.includes(req.query.type) ? req.query.type : null;
  const scope = { sellerId: seller._id, isDeleted: false, ...(channel ? { type: channel } : {}) };

  const [productCount, liveCount, lowStockCount, outOfStockCount] = await Promise.all([
    Product.countDocuments(scope),
    Product.countDocuments({ ...scope, status: 'approved', isActive: true }),
    Product.countDocuments({ ...scope, stock: { $gt: 0, $lt: LOW_STOCK_THRESHOLD } }),
    Product.countDocuments({ ...scope, stock: 0 }),
  ]);

  /**
   * Revenue and order counts, computed from the orders themselves.
   *
   * These used to be read off `seller.totalRevenue` / `seller.totalOrders`, which
   * nothing ever increments — checkout does not touch them. So the dashboard
   * showed a flat zero to sellers who had genuinely been paid. Deriving the
   * figures from Order means they cannot drift out of step with reality.
   *
   * Two details matter:
   *  - Only this seller's line items count. An order can hold several sellers'
   *    goods, and the order total also carries shared delivery and discounts
   *    that are not any one seller's revenue.
   *  - The grouping runs in two stages so an order with four of this seller's
   *    items counts as one order, not four.
   */
  const revenueByChannel = await Order.aggregate([
    { $match: { 'items.sellerId': seller._id, status: { $nin: [ORDER_STATUS.CANCELLED, ORDER_STATUS.RETURNED, ORDER_STATUS.REFUNDED] } } },
    { $unwind: '$items' },
    // Re-filter after unwinding: the first $match kept whole orders, and those
    // orders may also contain other sellers' items.
    { $match: { 'items.sellerId': seller._id } },
    {
      $group: {
        _id: { channel: '$type', orderId: '$_id' },
        lineRevenue: { $sum: { $multiply: ['$items.price', '$items.qty'] } },
      },
    },
    {
      $group: {
        _id: '$_id.channel',
        revenue: { $sum: '$lineRevenue' },
        orders: { $sum: 1 },
      },
    },
  ]);

  /**
   * Orders this seller still owes work on.
   *
   * "Pending" means not yet handed over — once it is dispatched it is the
   * courier's problem, not the seller's, so it drops off this counter.
   */
  const pendingOrders = await Order.countDocuments({
    'items.sellerId': seller._id,
    status: { $in: [ORDER_STATUS.PLACED, ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING] },
    ...(channel ? { type: channel } : {}),
  });

  const perChannel = revenueByChannel.reduce(
    (acc, row) => ({ ...acc, [row._id]: { revenue: row.revenue, orders: row.orders } }),
    {}
  );

  const totals = revenueByChannel.reduce(
    (acc, row) => ({ revenue: acc.revenue + row.revenue, orders: acc.orders + row.orders }),
    { revenue: 0, orders: 0 }
  );

  // With ?type= set the KPIs describe that storefront alone; without it they
  // describe the whole account. Either way `byChannel` carries the split so a
  // hybrid seller can see both at once.
  const scoped = channel ? (perChannel[channel] || { revenue: 0, orders: 0 }) : totals;

  res.status(200).json({
    success: true,
    channel,
    kpis: {
      rating: seller.rating,
      totalOrders: scoped.orders,
      totalRevenue: Number(scoped.revenue.toFixed(2)),
      // Average order value belongs here rather than in the client, where it was
      // being rendered as the revenue figure a second time.
      avgOrderValue: scoped.orders ? Number((scoped.revenue / scoped.orders).toFixed(2)) : 0,
      pendingOrders,
      productCount,
      liveCount,
      lowStockCount,
      outOfStockCount,
    },
    byChannel: {
      [CHANNEL.ECOM]: perChannel[CHANNEL.ECOM] || { revenue: 0, orders: 0 },
      [CHANNEL.GROCERY]: perChannel[CHANNEL.GROCERY] || { revenue: 0, orders: 0 },
    },
  });
});

// @desc    Save which storefronts this seller sells through (Shop All / Quick)
// @route   PATCH /api/sellers/channels
// @access  Private (approved sellers)
export const updateSalesChannels = asyncHandler(async (req, res) => {
  const seller = req.seller || await Seller.findOne({ userId: req.user._id });
  if (!seller) {
    res.status(404);
    throw new Error('Seller profile not found');
  }

  const { channels } = req.body;
  if (!Array.isArray(channels)) {
    res.status(400);
    throw new Error('channels must be an array');
  }

  // The existing self-service toggle may only change already-supported retail
  // channels. Wholesale is approved separately by an administrator.
  const ALLOWED = [CHANNEL.ECOM, CHANNEL.GROCERY];
  if (channels.some((channel) => !ALLOWED.includes(channel))) {
    throw httpError(403, 'Wholesale must be requested and approved separately');
  }
  const cleaned = [...new Set(channels)];

  // A seller must sell somewhere — an empty selection would strand their
  // catalogue with no storefront to appear in.
  if (cleaned.length === 0) {
    res.status(400);
    throw new Error('Select at least one sales channel');
  }

  // Retain the separately approved wholesale capability when a seller toggles
  // their existing E-Commerce / Quick Commerce choices.
  const wholesaleApproved = seller.wholesaleChannel?.status === WHOLESALE_REQUEST_STATUS.APPROVED;
  seller.salesChannels = wholesaleApproved ? [...cleaned, WHOLESALE_CHANNEL] : cleaned;
  await seller.save();

  res.status(200).json({
    success: true,
    message: 'Sales channels updated',
    salesChannels: seller.salesChannels,
  });
});

// @desc    Request access to the Wholesale seller channel
// @route   POST /api/sellers/wholesale-request
// @access  Private (approved seller)
export const requestWholesaleChannel = asyncHandler(async (req, res) => {
  const seller = req.seller || await Seller.findOne({ userId: req.user._id });
  if (!seller || seller.status !== 'approved') throw httpError(403, 'An approved seller account is required');

  if (seller.wholesaleChannel?.status === WHOLESALE_REQUEST_STATUS.APPROVED && seller.salesChannels?.includes(WHOLESALE_CHANNEL)) {
    return res.status(200).json({ success: true, status: WHOLESALE_REQUEST_STATUS.APPROVED, salesChannels: seller.salesChannels });
  }
  if (seller.wholesaleChannel?.status === WHOLESALE_REQUEST_STATUS.SUSPENDED) {
    throw httpError(409, 'Wholesale access is suspended; contact an administrator to restore it');
  }
  if (seller.wholesaleChannel?.status !== WHOLESALE_REQUEST_STATUS.PENDING) {
    seller.wholesaleChannel = {
      status: WHOLESALE_REQUEST_STATUS.PENDING,
      requestedAt: new Date(),
    };
    await seller.save();
  }

  return res.status(202).json({
    success: true,
    message: 'Wholesale access request submitted for admin review',
    status: seller.wholesaleChannel.status,
    salesChannels: seller.salesChannels || [],
  });
});

// @desc    Request promotion slot (banner / sponsored)
// @route   POST /api/sellers/promo-request
// @access  Private
export const requestPromo = asyncHandler(async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user._id });
  if (!seller) {
    res.status(404);
    throw new Error('Seller profile not found');
  }

  const { type, startDate, endDate } = req.body;
  if (!type || !startDate || !endDate) {
    res.status(400);
    throw new Error('Please provide promotion type, start date and end date');
  }

  seller.promoRequests.push({
    type,
    status: 'pending',
    startDate: new Date(startDate),
    endDate: new Date(endDate)
  });

  await seller.save();
  res.status(200).json({
    success: true,
    message: 'Promotion request submitted successfully',
    seller
  });
});

// @desc    Orders containing this seller's items
// @route   GET /api/sellers/orders?status=&type=&page=&limit=
// @access  Private (approved sellers)
export const getSellerOrders = asyncHandler(async (req, res) => {
  const seller = req.seller || await Seller.findOne({ userId: req.user._id });
  if (!seller) {
    res.status(404);
    throw new Error('Seller profile not found');
  }

  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const skip = (page - 1) * limit;

  const filter = { 'items.sellerId': seller._id };
  if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;
  if (CHANNELS.includes(req.query.type)) filter.type = req.query.type;

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Order.countDocuments(filter),
  ]);

  /**
   * Reshape before answering, for two separate reasons.
   *
   * Privacy: an order can hold several sellers' goods. Returning it whole would
   * show this seller what a competitor sold to the same shopper, so the items
   * are filtered down to their own. The order-level pricing is dropped for the
   * same reason — it covers the whole basket, not this seller's share.
   *
   * Contact detail: the seller needs a name and a delivery address to pack and
   * hand over the parcel, so those stay. Nothing else about the shopper does.
   */
  const rows = orders.map((o) => {
    const mine = (o.items || []).filter((i) => String(i.sellerId) === String(seller._id));
    const subtotal = mine.reduce((sum, i) => sum + (i.price || 0) * (i.qty || 0), 0);

    return {
      _id: o._id,
      orderNo: o.orderNo,
      channel: o.type,
      status: o.status,
      paymentMethod: o.paymentMethod,
      placedAt: o.createdAt,
      items: mine.map((i) => ({
        productId: i.productId,
        name: i.name,
        image: i.image,
        qty: i.qty,
        price: i.price,
        additionalMessage: i.additionalMessage || '',
        lineTotal: Number(((i.price || 0) * (i.qty || 0)).toFixed(2)),
      })),
      itemCount: mine.reduce((n, i) => n + (i.qty || 0), 0),
      subtotal: Number(subtotal.toFixed(2)),
      customer: {
        name: o.shippingAddress?.name,
        city: o.shippingAddress?.city,
        pincode: o.shippingAddress?.pincode,
      },
      shippingAddress: o.shippingAddress,
      // The status trail, so a seller can see when each step happened.
      timeline: o.timeline || [],
      deliveryPartnerId: o.deliveryPartnerId,
      /**
       * Who is carrying this, and what the customer was promised.
       *
       * Without these the panel could only see the storefront, and Shop All has
       * two carriers — so a Same-Day parcel, which one of our riders collects,
       * was offered a "Hand to courier" button and a form demanding a waybill
       * the seller does not have. They could not complete it, the order never
       * reached `dispatched`, and no rider was ever rung.
       */
      deliveryType: o.deliveryType,
      deliveryMode: o.delivery?.mode,
      promisedBy: o.delivery?.promisedBy,
      // Courier and waybill for a Shop All parcel, so the shop can read back
      // what it entered rather than having to remember it.
      shiprocket: o.shiprocket?.awb ? o.shiprocket : undefined,
    };
  });

  res.status(200).json({
    success: true,
    data: rows,
    meta: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

// @desc    Update order status (Accept / Prepare / Dispatch)
// @route   PATCH /api/sellers/orders/:id/status
// @access  Private (Approved Sellers only)
export const updateOrderStatus = asyncHandler(async (req, res) => {
  const seller = req.seller || await Seller.findOne({ userId: req.user._id });
  if (!seller) {
    res.status(404);
    throw new Error('Seller profile not found');
  }

  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    res.status(400);
    throw new Error('Status is required');
  }

  const order = await Order.findById(id);
  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }

  // Ensure this seller owns items in the order
  const hasItems = order.items.some(item => String(item.sellerId) === String(seller._id));
  if (!hasItems) {
    res.status(403);
    throw new Error('You do not have permission to update this order');
  }

  const currentStatus = order.status;
  // Shop All parcels travel further under the shop's own reporting than Quick
  // ones do, because no rider takes over. The order's channel picks the rules.
  /**
   * How far the shop reports depends on who is carrying the parcel.
   *
   * A rider takes over at `dispatched` and reports everything after it, so the
   * shop's moves end there. A courier reports nothing back to this system, so
   * the shop stays the reporter to the end and needs the two extra states. That
   * is a carrier question, not a channel one — a Same-Day order is e-commerce
   * but hands over to a rider exactly like a Quick order does.
   */
  /**
   * "Accept" on an order the customer paid online can lose a race with the
   * payment itself.
   *
   * The seller is rung the moment an order is placed — before an online
   * payment has necessarily finished — but PhonePe's webhook (or the
   * customer's own return trip) can confirm the payment, and with it the
   * order (see payment.controller.js: settle()), before the seller taps
   * Accept. The tap still arrives as `status: 'confirmed'`; the order is
   * already `confirmed`. That is not an invalid transition to reject — it is
   * the seller agreeing to fulfil an order that has, in the meantime,
   * already been confirmed on their behalf by payment. Treated as a no-op
   * success rather than a same-state error.
   */
  if (status === ORDER_STATUS.CONFIRMED && currentStatus === ORDER_STATUS.CONFIRMED) {
    return res.status(200).json({
      success: true,
      message: 'Order already confirmed.',
      data: order,
    });
  }

  const allowedTransitions = vendorTransitions(order.deliveryType)[currentStatus] || [];
  if (!allowedTransitions.includes(status)) {
    res.status(400);
    throw new Error(`Invalid status transition from ${currentStatus} to ${status}`);
  }

  /**
   * Declining is not just another status write.
   *
   * Checkout already took the stock, spent the coupon and may have taken the
   * money. Setting `status = 'cancelled'` here and saving would leave all three
   * exactly as they were — units missing from a shelf that still holds them, a
   * coupon nobody can reuse, and a customer charged for nothing. So it goes
   * through the shared undo path instead.
   */
  if (status === ORDER_STATUS.CANCELLED) {
    const reason = (req.body.reason || '').trim();
    if (!reason) {
      res.status(400);
      throw new Error('Please give a reason — the customer is shown this');
    }

    const { cancelOrderAndRestore } = await import('./order.controller.js');
    const result = await cancelOrderAndRestore(order._id, {
      reason: `Declined by the store: ${reason}`,
      allowedFrom: VENDOR_CANCELLABLE_STATUSES,
      cancelledBy: 'seller',
    });

    if (!result.ok) {
      res.status(400);
      throw new Error(result.reason);
    }

    const cancelled = await Order.findById(order._id);
    return res.status(200).json({
      success: true,
      message: 'Order declined. Stock has been returned to your shelf.',
      data: cancelled,
    });
  }

  /**
   * Handing a parcel to a courier is the one status change that carries facts
   * with it.
   *
   * Once it leaves the shop this system cannot see it again — there is no rider
   * reporting position, and the courier does not talk to us. The waybill number
   * is the only thread the customer has left, so it is required rather than
   * optional: a "dispatched" with nothing attached tells them their parcel has
   * gone somewhere unknowable.
   *
   * These fields already existed on the order for the Shiprocket integration
   * that was never wired up. Filling them by hand now means that integration can
   * later write the same places without changing anything downstream.
   */
  /**
   * A courier hand-off, not an e-commerce order.
   *
   * This asked `order.type === ECOM`, which was right while Shop All had exactly
   * one carrier. It now has two: a Same-Day parcel is an e-commerce order that a
   * rider collects, and demanding a waybill number for it would block the
   * dispatch entirely. The carrier is the question, so `deliveryType` is what is
   * asked.
   */
  const goesByCourier = order.deliveryType === 'shiprocket';
  if (goesByCourier && status === ORDER_STATUS.DISPATCHED) {
    const courier = (req.body.courier || '').trim();
    const awb = (req.body.awb || '').trim();

    if (!courier || !awb) {
      res.status(400);
      throw new Error('Please enter the courier name and the tracking number before dispatching');
    }

    order.shiprocket = {
      ...(order.shiprocket?.toObject?.() || order.shiprocket || {}),
      courier,
      awb,
      trackingUrl: (req.body.trackingUrl || '').trim() || undefined,
      status: 'dispatched',
    };
  }

  order.status = status;
  order.timeline.push({
    status,
    timestamp: new Date(),
    note: goesByCourier && status === ORDER_STATUS.DISPATCHED
      ? `Handed to ${order.shiprocket.courier} · ${order.shiprocket.awb}`
      : `Order status updated to ${status} by seller`,
  });

  /**
   * Return & Refund — Phase 3: the courier-carried counterpart to
   * deliveryPartner.controller.js::verifyDeliveryOtp's own delivery stamp.
   * Guarded the same way the Coins block just below is — only on an actual
   * DISPATCHED-ish -> DELIVERED transition, which `currentStatus !==
   * DELIVERED` plus the transition-table check above already guarantee
   * happens at most once per order.
   */
  if (status === ORDER_STATUS.DELIVERED && currentStatus !== ORDER_STATUS.DELIVERED) {
    const deliveredAt = new Date();
    for (const item of order.items) {
      const { returnEligible, returnWindowDays } = item.returnPolicy || {};
      const eligibleUntil = returnEligible && Number.isFinite(returnWindowDays) && returnWindowDays > 0
        ? new Date(deliveredAt.getTime() + returnWindowDays * 24 * 60 * 60 * 1000)
        : null;
      item.deliveredAt = deliveredAt;
      item.returnEligibleUntil = eligibleUntil;
      // NHCONE Coins (Phase 7) — see deliveryPartner.controller.js::verifyDeliveryOtp
      // for the identical rider-carried case; this is the courier-carried one.
      item.coinRewardStatus = 'PENDING';
      item.coinRewardEligibleAt = eligibleUntil || deliveredAt;
    }
  }

  await order.save();

  // NHCONE Coins (Phase 7) — no immediate credit on delivery anymore. Every
  // item was just stamped `coinRewardStatus: 'PENDING'` above (the
  // courier/Shiprocket-carried case; deliveryPartner.controller.js's
  // verifyDeliveryOtp does the identical stamp for the rider-carried case);
  // the return-window-aware sweeper decides and credits it later.

  // Socket notification to the buyer
  try {
    const { emitToUser } = await import('../socket/rooms.js');
    emitToUser(order.userId, 'order_status_updated', {
      orderId: order._id,
      status,
      timeline: order.timeline
    });
    notifyUser(order.userId, {
      event: NOTIFICATION_EVENT.ORDER_STATUS_UPDATED,
      title: 'Order update',
      message: `Order ${order.orderNo} is now ${status}.`,
      metadata: { orderId: order._id },
      route: '/orders',
    }).catch((e) => console.error('[NOTIFICATION] notifyUser (order status) failed:', e.message));

    // NHCONE Coins (Phase 7) — no synchronous credit at this point anymore,
    // so no "Coins added" notification fires here either (see Phase 7 note above).

    /**
     * Ring riders only for the orders our own riders carry.
     *
     * This used to fire on `dispatched` for any channel. Now that a Shop All
     * parcel reaches `dispatched` too — on its way to a courier — that would
     * offer riders a job nobody can do: no pickup window, no Delivery record,
     * and a parcel already handed over. Internal delivery is the test, not the
     * status.
     */
    /**
     * Ring riders only for parcels our own riders carry.
     *
     * The test used to be the channel, which excluded every Shop All order. A
     * Same-Day order is Shop All and does need a rider, so the carrier decides.
     *
     * The two moments differ on purpose. Quick rings at `confirmed`, before the
     * shop has packed, because thirty minutes does not allow a rider to be found
     * afterwards. Same-Day rings at `dispatched` — packed and ready — so a rider
     * is not left standing in a shop waiting for a parcel that is still being
     * put together.
     */
    const usesOwnRiders = order.deliveryType !== 'shiprocket';
    const isQuick = order.type === CHANNEL.GROCERY;
    if (usesOwnRiders
      && ((status === ORDER_STATUS.CONFIRMED && isQuick) || status === ORDER_STATUS.DISPATCHED)) {
      const { broadcastNewOrderToRiders } = await import('./deliveryPartner.controller.js');
      // Run in background asynchronously so it doesn't block response
      broadcastNewOrderToRiders(order._id).catch(console.error);
    }
  } catch (err) {
    console.error('Socket notification failed:', err.message);
  }

  res.status(200).json({
    success: true,
    message: `Order status updated to ${status}`,
    data: order
  });
});

// @desc    Buyer questions asked on this seller's own products
// @route   GET /api/sellers/faqs
// @access  Private (Approved Sellers only)
export const getSellerFaqs = asyncHandler(async (req, res) => {
  const seller = req.seller || await Seller.findOne({ userId: req.user._id });
  if (!seller) {
    res.status(404);
    throw new Error('Seller profile not found');
  }

  const rows = await Product.aggregate([
    { $match: { sellerId: seller._id, 'faqs.0': { $exists: true } } },
    { $unwind: '$faqs' },
    { $project: {
      _id: '$faqs._id',
      productId: '$_id',
      productName: '$name',
      userName: '$faqs.userName',
      question: '$faqs.question',
      answer: '$faqs.answer',
      status: '$faqs.status',
      createdAt: '$faqs.createdAt',
      answeredAt: '$faqs.answeredAt',
    } },
    { $sort: { createdAt: -1 } },
  ]);

  res.status(200).json({ success: true, data: { faqs: rows } });
});

// @desc    Seller answers a buyer's question on their own product
// @route   PATCH /api/sellers/faqs/:faqId/answer
// @access  Private (Approved Sellers only)
export const answerSellerFaq = asyncHandler(async (req, res) => {
  const seller = req.seller || await Seller.findOne({ userId: req.user._id });
  if (!seller) {
    res.status(404);
    throw new Error('Seller profile not found');
  }

  const answer = String(req.body.answer || '').trim();
  if (!answer) {
    res.status(400);
    throw new Error('Please type an answer');
  }

  // Scoped to this seller's own products — matching a faqId that lives on
  // someone else's listing must fail exactly like a non-existent one.
  const product = await Product.findOne({ sellerId: seller._id, 'faqs._id': req.params.faqId });
  if (!product) {
    res.status(404);
    throw new Error('Question not found');
  }

  const answeredAt = new Date();

  // A targeted update, not `product.save()` — answering a question never
  // touches this product's own pricing/variants, so it must not be able to
  // fail on, or rewrite, unrelated fields via the pre-validate hook.
  await Product.updateOne(
    { _id: product._id, 'faqs._id': req.params.faqId },
    {
      $set: {
        'faqs.$.answer': answer,
        'faqs.$.answeredBy': seller.storeDetails?.name || '',
        'faqs.$.status': 'answered',
        'faqs.$.answeredAt': answeredAt,
      },
    }
  );

  res.status(200).json({ success: true, message: 'Answer submitted' });
});

