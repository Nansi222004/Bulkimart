import User from '../models/User.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { uploadToCloudinary } from '../services/cloudinary.service.js';
import { registerPushToken } from '../services/notification.service.js';

const normalizeAddressPart = (value) => String(value ?? '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('en-IN');

// Recipient names, phone numbers, labels, coordinates and landmark photos do
// not make a physical destination different. This key deliberately describes
// only the address customers see and type.
const addressIdentity = (address = {}) => [
  address.line1,
  address.line2,
  address.city,
  address.state,
  address.pincode,
].map(normalizeAddressPart).join('|');

const uniqueAddresses = (addresses = []) => {
  const seen = new Set();
  return addresses.filter((address) => {
    const key = addressIdentity(address);
    if (!key.replaceAll('|', '') || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

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

  const { name, email } = req.body;
  if (name) user.name = name;
  if (email) user.email = email;
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
  // Older versions allowed the same destination to be appended repeatedly.
  // Hide those historical duplicates without deleting production data.
  const unique = uniqueAddresses(sorted);

  res.status(200).json({ success: true, data: unique, message: '', meta: { total: unique.length } });
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

  // Use authenticated customer's profile details as primary source
  const profileName = user?.name != null ? String(user.name).trim() : '';
  const profilePhone = user?.phone != null ? String(user.phone).trim() : '';
  const recipientName = profileName || (name != null ? String(name).trim() : '');
  const recipientPhone = profilePhone || (phone != null ? String(phone).trim() : '');

  if (!recipientName) {
    res.status(400);
    throw new Error('Please complete your profile name before saving an address');
  }
  if (!recipientPhone) {
    res.status(400);
    throw new Error('Please complete your profile mobile number before saving an address');
  }

  const newAddress = {
    label: label || 'Home',
    name: recipientName,
    phone: recipientPhone,
    line1,
    line2,
    city,
    state,
    pincode,
    lat,
    lng,
    locationSource,
    isDefault,
    placeName,
    landmarkImage: landmarkImage || null,
  };

  const duplicate = user.addresses.find((address) =>
    addressIdentity(address) === addressIdentity(newAddress)
  );
  if (duplicate) {
    return res.status(200).json({
      success: true,
      addresses: uniqueAddresses(user.addresses),
      data: { addressId: duplicate._id, duplicate: true },
      message: 'This address is already saved and has been selected.',
    });
  }

  if (isDefault) {
    user.addresses.forEach(addr => addr.isDefault = false);
  } else if (user.addresses.length === 0) {
    newAddress.isDefault = true;
  }

  user.addresses.push(newAddress);
  await user.save();

  res.status(201).json({
    success: true,
    addresses: user.addresses,
    data: { addressId: user.addresses[user.addresses.length - 1]?._id, duplicate: false },
    message: 'Address saved',
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

  // Ensure editing an address uses authenticated identity and never overwrites valid contact details with empty values
  const profileName = user?.name != null ? String(user.name).trim() : '';
  const profilePhone = user?.phone != null ? String(user.phone).trim() : '';
  if (name != null && String(name).trim()) {
    address.name = profileName || String(name).trim();
  } else if (!address.name && profileName) {
    address.name = profileName;
  }

  if (phone != null && String(phone).trim()) {
    address.phone = profilePhone || String(phone).trim();
  } else if (!address.phone && profilePhone) {
    address.phone = profilePhone;
  }

  if (line1) address.line1 = line1;
  if (line2 !== undefined) address.line2 = line2;
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
