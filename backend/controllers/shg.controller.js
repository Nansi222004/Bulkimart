import SHGStore from '../models/SHGStore.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { uploadToCloudinary } from '../services/cloudinary.service.js';
import { buildChannelMatch } from './product.controller.js';

/**
 * The storefronts an SHG vendor's panel can be scoped to.
 *
 * `Order.type` only ever holds `ecommerce`/`grocery`/`subscription` — an
 * order is tagged by which storefront cart the customer checked out through,
 * and there is no such thing as a "shg" order. So "SHG Store" mode (the
 * default) means every order this SHG has, unfiltered; only switching to
 * Ecommerce or Quick actually narrows anything. Filtering orders by
 * `type: 'shg'` would silently return zero forever.
 */
const ORDER_FILTERABLE_TYPES = ['ecommerce', 'grocery'];

/**
 * Products this SHG store owns, scoped to a storefront — reuses the exact
 * same match product.controller.js's storefronts already query with, so the
 * "is this product visible in channel X" rule lives in one place. An SHG
 * product's primary channel is always `shg`, so `buildChannelMatch('shg')`
 * matches every product the store owns; `buildChannelMatch('ecommerce'|
 * 'grocery')` matches only the ones actively cross-listed into that channel.
 */
const shgProductFilter = (shgStoreId, type) => {
  const filter = { shgStoreId };
  if (type === 'ecommerce' || type === 'grocery') {
    Object.assign(filter, buildChannelMatch(type));
  }
  return filter;
};

// Helper to notify admins
const notifyAdmins = async (title, message) => {
  console.log(`[ADMIN NOTIFICATION] Title: ${title} | Message: ${message}`);
};

// @desc    Start SHG onboarding
// @route   POST /api/shg/start
// @access  Private
export const startSHGOnboarding = asyncHandler(async (req, res) => {
  let shgStore = await SHGStore.findOne({ userId: req.user._id });

  if (!shgStore) {
    shgStore = await SHGStore.create({
      userId: req.user._id,
      shgRegId: req.user.shgRegNo,
      onboardingStep: 1,
      status: 'incomplete'
    });
  }

  // Link the profile only — the 'shg' role (which unlocks the SHG panel) is
  // granted on admin approval, not at registration.
  await User.updateOne({ _id: req.user._id }, { $set: { shgStoreId: shgStore._id } });

  res.status(200).json({
    success: true,
    shgStore
  });
});

// @desc    Step 1: Group Info
// @route   PUT /api/shg/step/1
// @access  Private
export const submitSHGStep1 = asyncHandler(async (req, res) => {
  const shgStore = await SHGStore.findOne({ userId: req.user._id });
  if (!shgStore) {
    res.status(404);
    throw new Error('SHG profile not initiated');
  }

  const {
    groupName, houseNo, street, landmark, village, block, district, state, pincode,
    lat, lng, locationSource, accuracy,
    leaderName, formationYear, totalMembers, primaryCategory, shgRegId
  } = req.body;

  const targetGroupName = groupName !== undefined ? groupName : shgStore.groupName;
  const targetPincode = pincode !== undefined ? pincode : shgStore.pincode;

  if (!targetGroupName || !targetPincode) {
    res.status(400);
    throw new Error('Please fill all required group profile fields');
  }

  if (groupName !== undefined) shgStore.groupName = groupName;
  if (houseNo !== undefined) shgStore.houseNo = houseNo;
  if (street !== undefined) shgStore.street = street;
  if (landmark !== undefined) shgStore.landmark = landmark;
  if (village !== undefined) shgStore.village = village;
  if (block !== undefined) shgStore.block = block;
  if (district !== undefined) shgStore.district = district;
  if (state !== undefined) shgStore.state = state;
  if (pincode !== undefined) shgStore.pincode = pincode;

  // Validate and persist store coordinates
  if (lat !== undefined && lng !== undefined && lat !== null && lng !== null) {
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    if (isNaN(parsedLat) || parsedLat < -90 || parsedLat > 90) {
      res.status(400);
      throw new Error('Invalid latitude. Must be between -90 and 90');
    }
    if (isNaN(parsedLng) || parsedLng < -180 || parsedLng > 180) {
      res.status(400);
      throw new Error('Invalid longitude. Must be between -180 and 180');
    }

    shgStore.lat = parsedLat;
    shgStore.lng = parsedLng;
    // MongoDB GeoJSON format: [longitude, latitude]
    shgStore.point = { type: 'Point', coordinates: [parsedLng, parsedLat] };

    if (locationSource && ['gps', 'manual'].includes(locationSource)) {
      shgStore.locationSource = locationSource;
    } else if (!shgStore.locationSource) {
      shgStore.locationSource = 'gps';
    }

    if (accuracy !== undefined && accuracy !== null) {
      const parsedAccuracy = parseFloat(accuracy);
      if (!isNaN(parsedAccuracy) && parsedAccuracy >= 0) {
        shgStore.accuracy = parsedAccuracy;
      }
    }
  }

  if (leaderName !== undefined) shgStore.leaderName = leaderName;
  if (formationYear !== undefined) shgStore.formationYear = Number(formationYear);
  if (totalMembers !== undefined) shgStore.totalMembers = Number(totalMembers);
  if (primaryCategory !== undefined) shgStore.primaryCategory = primaryCategory;
  if (shgRegId !== undefined) shgStore.shgRegId = shgRegId;

  if (shgStore.onboardingStep < 2) {
    shgStore.onboardingStep = 2;
  }

  await shgStore.save();
  res.status(200).json({ success: true, shgStore });
});

// @desc    Step 2: Leader Aadhaar upload
// @route   PUT /api/shg/step/2
// @access  Private
export const submitSHGStep2 = asyncHandler(async (req, res) => {
  const shgStore = await SHGStore.findOne({ userId: req.user._id });
  if (!shgStore) {
    res.status(404);
    throw new Error('SHG profile not initiated');
  }

  const { number } = req.body;
  if (!number) {
    res.status(400);
    throw new Error('Please provide leader Aadhaar number');
  }

  if (!req.files || !req.files.leaderAadhaarFront || !req.files.leaderAadhaarBack) {
    res.status(400);
    throw new Error('Please upload Aadhaar front and back photos');
  }

  const frontUrl = await uploadToCloudinary(req.files.leaderAadhaarFront[0].buffer, `shg-kyc/${req.user._id}`);
  const backUrl = await uploadToCloudinary(req.files.leaderAadhaarBack[0].buffer, `shg-kyc/${req.user._id}`);

  shgStore.leaderAadhaar = {
    number: `XXXX-XXXX-${number.slice(-4)}`,
    frontUrl,
    backUrl
  };

  if (shgStore.onboardingStep < 3) {
    shgStore.onboardingStep = 3;
  }

  await shgStore.save();
  res.status(200).json({ success: true, shgStore });
});

// @desc    Step 3: NRLM ID and SHG certificate
// @route   PUT /api/shg/step/3
// @access  Private
export const submitSHGStep3 = asyncHandler(async (req, res) => {
  const shgStore = await SHGStore.findOne({ userId: req.user._id });
  if (!shgStore) {
    res.status(404);
    throw new Error('SHG profile not initiated');
  }

  const { nrlmId } = req.body;
  if (!nrlmId) {
    res.status(400);
    throw new Error('NRLM ID is required');
  }

  if (req.files && req.files.shgCert) {
    const shgCertUrl = await uploadToCloudinary(req.files.shgCert[0].buffer, `shg-certs/${req.user._id}-cert`);
    shgStore.shgCertUrl = shgCertUrl;
  }

  if (req.files && req.files.nrlmCert) {
    const nrlCertUrl = await uploadToCloudinary(req.files.nrlmCert[0].buffer, `shg-certs/${req.user._id}-nrlm`);
    shgStore.nrlmCertUrl = nrlCertUrl;
  }

  shgStore.nrlmId = nrlmId;

  if (shgStore.onboardingStep < 4) {
    shgStore.onboardingStep = 4;
  }

  await shgStore.save();
  res.status(200).json({ success: true, shgStore });
});

// @desc    Step 4: Group Bank Account Details
// @route   PUT /api/shg/step/4
// @access  Private
export const submitSHGStep4 = asyncHandler(async (req, res) => {
  const shgStore = await SHGStore.findOne({ userId: req.user._id });
  if (!shgStore) {
    res.status(404);
    throw new Error('SHG profile not initiated');
  }

  const { accountNo, ifsc, holderName, bankName } = req.body;
  const finalHolderName = holderName || shgStore.groupName;
  if (!accountNo || !ifsc || !finalHolderName || !bankName) {
    res.status(400);
    throw new Error('Please fill all bank details');
  }

  if (!req.file) {
    res.status(400);
    throw new Error('Please upload passbook front page copy');
  }

  const passbookUrl = await uploadToCloudinary(req.file.buffer, `shg-bank/${req.user._id}`);

  shgStore.groupBankAccount = {
    accountNo,
    ifsc,
    holderName: finalHolderName,
    bankName,
    passbookUrl
  };

  if (shgStore.onboardingStep < 5) {
    shgStore.onboardingStep = 5;
  }

  await shgStore.save();
  res.status(200).json({ success: true, shgStore });
});

// @desc    Step 5: Members & Product Categories selection
// @route   PUT /api/shg/step/5
// @access  Private
export const submitSHGStep5 = asyncHandler(async (req, res) => {
  const shgStore = await SHGStore.findOne({ userId: req.user._id });
  if (!shgStore) {
    res.status(404);
    throw new Error('SHG profile not initiated');
  }

  const { members, productCategories } = req.body;
  
  if (members) {
    shgStore.members = typeof members === 'string' ? JSON.parse(members) : members;
  }
  if (productCategories) {
    shgStore.productCategories = typeof productCategories === 'string' ? JSON.parse(productCategories) : productCategories;
  }

  await shgStore.save();
  res.status(200).json({ success: true, shgStore });
});

// @desc    Submit SHG application
// @route   POST /api/shg/submit
// @access  Private
export const submitSHGApplication = asyncHandler(async (req, res) => {
  const shgStore = await SHGStore.findOne({ userId: req.user._id });
  if (!shgStore) {
    res.status(404);
    throw new Error('SHG store not found');
  }

  if (shgStore.onboardingStep < 5) {
    res.status(400);
    throw new Error('Please complete all onboarding steps first');
  }

  shgStore.status = 'pending';
  await shgStore.save();

  await notifyAdmins('New SHG Store Application', `SHG "${shgStore.groupName}" has submitted onboarding application.`);

  res.status(200).json({
    success: true,
    message: 'Application submitted for review successfully',
    shgStore
  });
});

// @desc    Get current SHG store status
// @route   GET /api/shg/me
// @access  Private
export const getMySHGProfile = asyncHandler(async (req, res) => {
  const shgStore = await SHGStore.findOne({ userId: req.user._id }).populate('productCategories');
  if (!shgStore) {
    res.status(404);
    throw new Error('SHG store not found');
  }

  res.status(200).json({
    success: true,
    shgStore
  });
});

// @desc    Get SHG dashboard metrics
// @route   GET /api/shg/dashboard
// @access  Private
// @query   type — 'shg' (default) | 'ecommerce' | 'grocery', scopes
//          productsCount and totalOrders to that storefront.
export const getSHGDashboard = asyncHandler(async (req, res) => {
  const shgStore = await SHGStore.findOne({ userId: req.user._id });
  if (!shgStore) {
    res.status(404);
    throw new Error('SHG store not found');
  }

  const { type } = req.query;

  const orderFilter = { 'items.shgStoreId': shgStore._id };
  if (ORDER_FILTERABLE_TYPES.includes(type)) orderFilter.type = type;

  const [productsCount, totalOrders] = await Promise.all([
    Product.countDocuments(shgProductFilter(shgStore._id, type)),
    Order.countDocuments(orderFilter),
  ]);

  res.status(200).json({
    success: true,
    kpis: {
      rating: shgStore.rating,
      totalOrders,
      productsCount,
      membersCount: shgStore.members.length
    }
  });
});

// @desc    Get group members
// @route   GET /api/shg/members
// @access  Private
export const getSHGMembers = asyncHandler(async (req, res) => {
  const shgStore = await SHGStore.findOne({ userId: req.user._id });
  if (!shgStore) {
    res.status(404);
    throw new Error('SHG store not found');
  }

  res.status(200).json({
    success: true,
    members: shgStore.members
  });
});

// @desc    Add member
// @route   POST /api/shg/members
// @access  Private
export const addSHGMember = asyncHandler(async (req, res) => {
  const shgStore = await SHGStore.findOne({ userId: req.user._id });
  if (!shgStore) {
    res.status(404);
    throw new Error('SHG store not found');
  }

  const { name, phone, role } = req.body;
  if (!name || !phone || !role) {
    res.status(400);
    throw new Error('Please fill all member fields');
  }

  shgStore.members.push({ name, phone, role });
  await shgStore.save();

  res.status(200).json({
    success: true,
    members: shgStore.members
  });
});

// @desc    Remove member
// @route   DELETE /api/shg/members/:memberId
// @access  Private
export const deleteSHGMember = asyncHandler(async (req, res) => {
  const shgStore = await SHGStore.findOne({ userId: req.user._id });
  if (!shgStore) {
    res.status(404);
    throw new Error('SHG store not found');
  }

  const { memberId } = req.params;
  shgStore.members.pull(memberId);
  await shgStore.save();

  res.status(200).json({
    success: true,
    members: shgStore.members
  });
});

// @desc    Orders containing this SHG's items
// @route   GET /api/shg/orders
// @access  Private (approved SHG)
export const getSHGOrders = asyncHandler(async (req, res) => {
  const shgStore = req.shgStore || await SHGStore.findOne({ userId: req.user._id });
  if (!shgStore) {
    res.status(404);
    throw new Error('SHG store not found');
  }

  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const skip = (page - 1) * limit;

  const filter = { 'items.shgStoreId': shgStore._id };
  if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;
  // 'shg' (the default/unset case) intentionally applies no type filter — see
  // ORDER_FILTERABLE_TYPES above for why.
  if (ORDER_FILTERABLE_TYPES.includes(req.query.type)) filter.type = req.query.type;

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Order.countDocuments(filter),
  ]);

  const rows = orders.map((o) => {
    const mine = (o.items || []).filter((i) => String(i.shgStoreId) === String(shgStore._id));
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
        qty: i.qty,
        price: i.price,
        image: i.image,
      })),
      totals: {
        itemsCount: mine.reduce((sum, i) => sum + (i.qty || 0), 0),
        subtotal,
      },
      shipping: o.shippingAddress ? {
        name: o.shippingAddress.name,
        phone: o.shippingAddress.phone,
        address: `${o.shippingAddress.line1 || ''}, ${o.shippingAddress.line2 || ''}, ${o.shippingAddress.city || ''}`.trim().replace(/^,\s*|,\s*$/g, ''),
      } : null,
    };
  });

  res.status(200).json({
    success: true,
    data: rows,
    meta: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  });
});

// @desc    Update status of an order item for this SHG
// @route   PATCH /api/shg/orders/:id/status
// @access  Private (approved SHG)
export const updateSHGOrderStatus = asyncHandler(async (req, res) => {
  const shgStore = req.shgStore || await SHGStore.findOne({ userId: req.user._id });
  if (!shgStore) {
    res.status(404);
    throw new Error('SHG store not found');
  }

  const order = await Order.findById(req.params.id);
  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }

  const hasItems = order.items.some((i) => String(i.shgStoreId) === String(shgStore._id));
  if (!hasItems) {
    res.status(403);
    throw new Error('Access denied — order does not belong to this SHG');
  }

  const { status } = req.body;
  if (!status) {
    res.status(400);
    throw new Error('Please provide status');
  }

  order.status = status;
  await order.save();

  res.status(200).json({
    success: true,
    message: `Order status updated to ${status}`,
    order,
  });
});
