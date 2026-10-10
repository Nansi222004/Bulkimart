import User from '../models/User.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { uploadToCloudinary } from '../services/cloudinary.service.js';
import { verifyCDSMembership } from '../services/cds.service.js';
import { registerPushToken } from '../services/notification.service.js';

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
export const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  res.status(200).json({
    success: true,
    user
  });
});

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
export const updateProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  const { name, email, isShgMember, shgRegNo } = req.body;
  if (name) user.name = name;
  if (email) user.email = email;
  if (isShgMember !== undefined) user.isShgMember = isShgMember;
  if (shgRegNo !== undefined) {
    if (shgRegNo && shgRegNo.trim()) {
      const existingUser = await User.findOne({ shgRegNo: shgRegNo.trim(), _id: { $ne: user._id } });
      if (existingUser) {
        res.status(400);
        throw new Error('This SHG Registration ID is already registered.');
      }
      user.shgRegNo = shgRegNo.trim();
    } else {
      user.shgRegNo = undefined;
    }
  }

  if (req.file) {
    const avatarUrl = await uploadToCloudinary(req.file.buffer, 'avatars');
    user.avatar = avatarUrl;
  }

  const updatedUser = await user.save();
  res.status(200).json({
    success: true,
    user: updatedUser
  });
});

// @desc    List my saved delivery addresses
// @route   GET /api/users/addresses
// @access  Private
export const getAddresses = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id, 'addresses');
  const list = user?.addresses || [];

  // Default first, so the checkout screen can pick list[0] and be right.
  const sorted = [...list].sort((a, b) => (b.isDefault === true) - (a.isDefault === true));

  res.status(200).json({ success: true, data: sorted, message: '', meta: { total: sorted.length } });
});

// @desc    Upload landmark image for customer address
// @route   POST /api/users/addresses/upload-landmark
// @access  Private
export const uploadLandmarkImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error('Please select an image file to upload');
  }

  const imageUrl = await uploadToCloudinary(req.file.buffer, 'landmark-images');
  res.status(200).json({
    success: true,
    imageUrl,
    message: 'Landmark image uploaded successfully'
  });
});

// @desc    Add shipping address
// @route   POST /api/users/addresses
// @access  Private
export const addAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  const { label, name, phone, line1, line2, city, state, pincode, lat, lng, locationSource, isDefault, placeName, landmarkImage } = req.body;

  const newAddress = { label, name, phone, line1, line2, city, state, pincode, lat, lng, locationSource, isDefault, placeName, landmarkImage: landmarkImage || null };

  if (isDefault) {
    user.addresses.forEach(addr => addr.isDefault = false);
  } else if (user.addresses.length === 0) {
    newAddress.isDefault = true;
  }

  user.addresses.push(newAddress);
  await user.save();

  res.status(201).json({
    success: true,
    addresses: user.addresses
  });
});

// @desc    Update address
// @route   PUT /api/users/addresses/:addressId
// @access  Private
export const updateAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  const { addressId } = req.params;
  const address = user.addresses.id(addressId);
  if (!address) {
    res.status(404);
    throw new Error('Address not found');
  }

  const { label, name, phone, line1, line2, city, state, pincode, lat, lng, locationSource, isDefault, placeName, landmarkImage } = req.body;

  if (label) address.label = label;
  if (name) address.name = name;
  if (phone) address.phone = phone;
  if (line1) address.line1 = line1;
  if (line2) address.line2 = line2;
  if (city) address.city = city;
  if (state) address.state = state;
  if (pincode) address.pincode = pincode;
  if (lat !== undefined) address.lat = lat;
  if (lng !== undefined) address.lng = lng;
  if (placeName !== undefined) address.placeName = placeName;
  if (landmarkImage !== undefined) address.landmarkImage = landmarkImage;
  // Recorded alongside the pin: a GPS reading and a geocoded guess are not
  // the same claim, and a rider standing in the wrong street deserves to know.
  if (locationSource) address.locationSource = locationSource;

  if (isDefault) {
    user.addresses.forEach(addr => addr.isDefault = false);
    address.isDefault = true;
  }

  await user.save();
  res.status(200).json({
    success: true,
    addresses: user.addresses
  });
});

// @desc    Delete address
// @route   DELETE /api/users/addresses/:addressId
// @access  Private
export const deleteAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  const { addressId } = req.params;
  
  // Find address
  const address = user.addresses.id(addressId);
  if (!address) {
    res.status(404);
    throw new Error('Address not found');
  }

  const wasDefault = address.isDefault;
  user.addresses.pull(addressId);

  // If we deleted the default address, make the first remaining address default
  if (wasDefault && user.addresses.length > 0) {
    user.addresses[0].isDefault = true;
  }

  await user.save();
  res.status(200).json({
    success: true,
    addresses: user.addresses
  });
});

// @desc    Set address as default
// @route   PUT /api/users/addresses/:addressId/default
// @access  Private
export const setDefaultAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  const { addressId } = req.params;
  const address = user.addresses.id(addressId);
  if (!address) {
    res.status(404);
    throw new Error('Address not found');
  }

  user.addresses.forEach(addr => {
    addr.isDefault = (addr._id.toString() === addressId);
  });

  await user.save();
  res.status(200).json({
    success: true,
    addresses: user.addresses
  });
});

// @desc    Get wallet details
// @route   GET /api/users/wallet
// @access  Private
export const getWallet = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('wallet');
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  res.status(200).json({
    success: true,
    wallet: user.wallet
  });
});

// @desc    Verify and link CDS Membership
// @route   POST /api/users/cds/verify
// @access  Private
export const verifyCDS = asyncHandler(async (req, res) => {
  const { membershipNo } = req.body;
  if (!membershipNo) {
    res.status(400);
    throw new Error('Please provide a CDS membership number');
  }

  const result = await verifyCDSMembership(membershipNo);
  if (!result.isValid) {
    res.status(400);
    throw new Error(result.message || 'Verification failed');
  }

  const user = await User.findById(req.user._id);
  user.cdsMembershipNo = membershipNo;
  user.isCDSVerified = true;
  user.cdsVerifiedAt = new Date();
  await user.save();

  res.status(200).json({
    success: true,
    verified: true,
    discountPercent: result.discount,
    message: result.message
  });
});

// @desc    Update FCM Push token
// @route   PUT /api/users/fcm-token
// @access  Private
// Legacy alias, kept for any existing caller — delegates to the canonical
// token service (services/notification.service.js) instead of duplicating
// the upsert logic. Prefer POST /api/notifications/tokens for new code.
export const updateFCMToken = asyncHandler(async (req, res) => {
  const { fcmToken } = req.body;
  if (!fcmToken) {
    res.status(400);
    throw new Error('Please provide an FCM token');
  }

  await registerPushToken(req.user._id, fcmToken);

  res.status(200).json({
    success: true,
    message: 'FCM Token updated successfully'
  });
});
