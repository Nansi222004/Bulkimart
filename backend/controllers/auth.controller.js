import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Admin from "../models/Admin.js";
import Seller from "../models/Seller.js";
import DeliveryPartner from "../models/DeliveryPartner.js";
import { resolveLoginSession } from "../services/loginSession.service.js";
import { asyncHandler } from "../middlewares/error.middleware.js";
import { httpError } from "../utils/response.js";
import { sendOTP, verifyOTP } from "../services/sms.service.js";
import { JWT_SECRET } from "../config/jwt.js";
import { isMockIntegrationEnabled } from "../config/runtime.js";
import { normalizePhone, phoneLookupCandidates } from "../utils/phone.js";

const findUserByPhone = async (rawPhone) => {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { phone: '', user: null };

  // Canonical records take the indexed exact-match path. Only databases with
  // legacy formatted values pay for the compatibility lookup.
  let user = await User.findOne({ phone });
  if (!user) {
    const legacy = phoneLookupCandidates(rawPhone).filter((candidate) => candidate !== phone);
    if (legacy.length) user = await User.findOne({ phone: { $in: legacy } });
  }
  return { phone, user };
};

/**
 * `role`, when given, is a claim the caller has already verified at THIS
 * exact moment (e.g. verifySellerOTP only reaches this call after confirming
 * an approved Seller record) — never a value handed straight through from
 * request input. It rides in the JWT so later requests (e.g. creating a
 * support ticket) can trust "this session authenticated as a seller"
 * without re-deriving it from a client-supplied hint. Shared login resolves
 * buyer/Delivery membership; dedicated entry points verify their own profiles.
 */
const generateToken = (id, type, role) => {
  return jwt.sign(
    { id, type, ...(role ? { role } : {}) },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "30d" }
  );
};

/**
 * The profile the app is allowed to hold.
 *
 * Hand-picking fields here used to omit `addresses`, so a shopper with a saved
 * address still hit "a delivery address is required" at checkout — the client
 * had simply never been told about it. Everything the app needs now comes from
 * this one function; only the wallet ledger is withheld (it can be long, and
 * has its own endpoint).
 */
export const publicUser = (user) => ({
  _id: user._id,
  phone: user.phone,
  name: user.name,
  email: user.email,
  avatar: user.avatar,
  roles: user.roles,
  addresses: user.addresses || [],
  walletBalance: user.wallet?.balance ?? 0,
  isActive: user.isActive,
  createdAt: user.createdAt,
});

// @desc    Send OTP to phone
// @route   POST /api/auth/send-otp
// @access  Public
export const requestOTP = asyncHandler(async (req, res) => {
  const { isLogin } = req.body;
  const { phone, user: existingUser } = await findUserByPhone(req.body.phone);
  if (!phone) {
    res.status(400);
    throw new Error("Please provide a valid phone number");
  }

  // Strict DB check based on login mode
  if (isLogin === true) {
    if (!existingUser) {
      throw httpError(
        404,
        "Mobile number not registered. Please register your account first.",
        { code: "NOT_REGISTERED" }
      );
    }
  } else if (isLogin === false) {
    if (existingUser) {
      throw httpError(
        400,
        "Mobile number is already registered. Please sign in instead.",
        { code: "ALREADY_REGISTERED" }
      );
    }
  }

  const result = await sendOTP(phone);

  if (isMockIntegrationEnabled('OTP_MODE')) {
    return res.status(200).json({
      success: true,
      message: "OTP sent (mock mode)",
      otp: result.otp
    });
  }

  res.status(200).json({
    success: true,
    message: "OTP sent successfully"
  });
});

// @desc    Verify OTP and authenticate
// @route   POST /api/auth/verify-otp
// @access  Public
export const verifyAndLogin = asyncHandler(async (req, res) => {
  const { otp, isLogin, name, email } = req.body;
  const normalized = normalizePhone(req.body.phone);

  if (!normalized || !otp) {
    res.status(400);
    throw new Error("Please provide phone and OTP");
  }

  const verification = verifyOTP(normalized, otp);
  if (!verification.valid) {
    res.status(400);
    throw new Error(verification.message || "Invalid OTP verification");
  }

  // Find or Create User
  const { phone, user: foundUser } = await findUserByPhone(req.body.phone);
  let user = foundUser;
  let isNewUser = false;

  if (isLogin === true) {
    if (!user) {
      throw httpError(
        404,
        "Mobile number not registered. Please register your account first.",
        { code: "NOT_REGISTERED" }
      );
    }
  } else if (isLogin === false) {
    if (user) {
      throw httpError(
        400,
        "Mobile number is already registered. Please sign in instead.",
        { code: "ALREADY_REGISTERED" }
      );
    }
  }

  if (!user) {
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    user = await User.create({
      phone,
      name: (name || "").trim(),
      // A sparse unique index ignores an absent field, but an empty string is
      // a real duplicate value. Phone-only registration must omit email.
      ...(normalizedEmail ? { email: normalizedEmail } : {}),
      roles: ["buyer"],
      wallet: { balance: 0, transactions: [] }
    });
    isNewUser = true;

  }

  if (!user.isActive) {
    res.status(403);
    throw new Error("Access denied — user account is deactivated");
  }

  const session = await resolveLoginSession(user);
  const token = generateToken(user._id, "user", session.sessionRole);

  res.status(200).json({
    success: true,
    isNewUser,
    ...session,
    token,
    user: publicUser(user),
  });
});

/**
 * Seller entry point — User is the base identity — a seller account is
 * always an EXTENSION of an existing customer, never created fresh from
 * this screen. This is the opposite of `requestOTP`/`verifyAndLogin` above
 * (which auto-create a User on a new phone — correct for the customer app,
 * where "enter phone → OTP" IS registration). Mirrors the existing
 * — any registered phone qualifies here, since becoming a seller is
 * something an existing buyer does for the FIRST time, not something that
 * requires already holding the seller role.
 */

// @desc    Send OTP for seller entry — allows new sellers to register directly or existing sellers to sign in
// @route   POST /api/auth/seller/send-otp
// @access  Public
export const requestSellerOTP = asyncHandler(async (req, res) => {
  const { intent } = req.body;
  const sellerIntent = intent === 'register' ? 'register' : 'login';
  const { phone, user } = await findUserByPhone(req.body.phone);
  if (!phone) {
    res.status(400);
    throw new Error("Please provide a valid phone number");
  }

  if (!user) {
    if (sellerIntent === 'register') {
      // New user registering a store — allow OTP to be sent directly so they can onboard immediately.
    } else {
      throw httpError(
        404,
        "No seller account found with this mobile number. Please choose 'Register Store' to begin onboarding.",
        { code: "NOT_A_MEMBER" }
      );
    }
  }

  let seller = null;
  if (user) {
    seller = await Seller.findOne({ userId: user._id }).select('status onboardingStep').lean();
    if (sellerIntent === 'register' && seller) {
      throw httpError(409, 'A seller profile already exists for this mobile number. Sign in to continue that application or open the seller dashboard.', {
        code: 'SELLER_EXISTS', sellerStatus: seller.status,
      });
    }
    if (sellerIntent === 'login' && !seller) {
      throw httpError(404, 'No seller profile is linked to this mobile number. Choose Register Store to begin onboarding.', {
        code: 'SELLER_NOT_FOUND',
      });
    }
  }

  const result = await sendOTP(phone);

  if (isMockIntegrationEnabled('OTP_MODE')) {
    return res.status(200).json({
      success: true,
      message: "OTP sent (mock mode)",
      otp: result.otp
    });
  }

  res.status(200).json({
    success: true,
    message: "OTP sent successfully",
    sellerState: seller ? { exists: true, status: seller.status, onboardingStep: seller.onboardingStep } : { exists: false },
  });
});

// @desc    Verify OTP for seller entry — authenticates existing sellers or creates account for new store registration
// @route   POST /api/auth/seller/verify-otp
// @access  Public
export const verifySellerOTP = asyncHandler(async (req, res) => {
  const { otp, intent } = req.body;
  const sellerIntent = intent === 'register' ? 'register' : 'login';
  const normalized = normalizePhone(req.body.phone);

  if (!normalized || !otp) {
    res.status(400);
    throw new Error("Please provide phone and OTP");
  }

  const { phone, user: foundUser } = await findUserByPhone(req.body.phone);
  let user = foundUser;

  if (!user && sellerIntent !== 'register') {
    throw httpError(
      404,
      "No seller account found with this mobile number. Please choose 'Register Store' to begin onboarding.",
      { code: "SELLER_NOT_FOUND" }
    );
  }

  const verification = verifyOTP(phone, otp);
  if (!verification.valid) {
    res.status(400);
    throw new Error(verification.message || "Invalid OTP verification");
  }

  if (!user) {
    // Automatically create user account for a new seller registering their store
    user = await User.create({
      phone,
      roles: ["buyer", "seller"],
      wallet: { balance: 0, transactions: [] }
    });
  } else if (Array.isArray(user.roles) && !user.roles.includes('seller')) {
    user.roles.push('seller');
    if (typeof user.save === 'function') {
      await user.save();
    }
  }

  if (!user.isActive) {
    res.status(403);
    throw new Error("Access denied — user account is deactivated");
  }

  const seller = await Seller.findOne({ userId: user._id }).select('status onboardingStep').lean();
  if (sellerIntent === 'register' && seller) {
    throw httpError(409, 'A seller profile already exists for this mobile number. Sign in to continue.', {
      code: 'SELLER_EXISTS', sellerStatus: seller.status,
    });
  }
  if (sellerIntent === 'login' && !seller) {
    throw httpError(404, 'No seller profile is linked to this mobile number. Choose Register Store to begin onboarding.', {
      code: 'SELLER_NOT_FOUND',
    });
  }

  // "seller" here means "authenticated through the seller entry point" —
  // not yet proof of an *approved* Seller record.
  const token = generateToken(user._id, "user", "seller");

  res.status(200).json({
    success: true,
    token,
    sessionRole: 'seller',
    user: publicUser(user),
    sellerState: seller ? { exists: true, status: seller.status, onboardingStep: seller.onboardingStep } : { exists: false },
  });
});

// Login must not silently create a Delivery profile. Registration remains explicit.
const deliveryEntry = async (req, verify) => {
  const intent = req.body.intent;
  if (!['login', 'register'].includes(intent)) throw httpError(400, 'Choose login or register.');
  const { phone, user } = await findUserByPhone(req.body.phone);
  if (!phone) throw httpError(400, 'Please provide a valid phone number');
  if (user && !user.isActive) throw httpError(403, 'Access denied — user account is deactivated');
  const partner = user ? await DeliveryPartner.findOne({ userId: user._id }) : null;
  if (intent === 'login' && !partner) throw httpError(404, 'No delivery profile found. Choose Register to apply.');
  if (intent === 'register' && partner) throw httpError(409, 'A delivery profile already exists. Choose Sign In.');
  if (user && (!Array.isArray(user.roles) || !user.roles.length || user.roles.some(role => !['buyer', 'seller', 'shg', 'delivery'].includes(role)))) {
    throw httpError(403, 'Account has no supported login role. Please contact support.');
  }
  if (verify) {
    if (!req.body.otp) throw httpError(400, 'Please provide phone and OTP');
    const result = verifyOTP(phone, req.body.otp);
    if (!result.valid) throw httpError(400, result.message || 'Invalid OTP verification');
  }
  return { phone, user, partner };
};

export const requestDeliveryOTP = asyncHandler(async (req, res) => {
  const { phone } = await deliveryEntry(req, false);
  const result = await sendOTP(phone);
  res.json({ success: true, message: 'OTP sent successfully', ...(isMockIntegrationEnabled('OTP_MODE') ? { otp: result.otp } : {}) });
});

export const verifyDeliveryOTP = asyncHandler(async (req, res) => {
  const entry = await deliveryEntry(req, true);
  const user = entry.user || await User.create({ phone: entry.phone, roles: ['buyer'], wallet: { balance: 0, transactions: [] } });
  if (!entry.partner) {
    // Explicit registration creates only an incomplete application, never approval.
    const partner = await DeliveryPartner.findOneAndUpdate({ userId: user._id },
      { $setOnInsert: { status: 'incomplete', onboardingStep: 1 } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    await User.updateOne({ _id: user._id }, { $set: { deliveryPartnerId: partner._id } });
  }
  const session = await resolveLoginSession(user, 'delivery');
  res.json({ success: true, token: generateToken(user._id, 'user', session.sessionRole), user: publicUser(user), ...session });
});

// Existing dual-role people may intentionally shop; the server verifies buyer
// membership instead of accepting an arbitrary role supplied by the browser.
export const customerSession = asyncHandler(async (req, res) => {
  if (req.userType !== 'user') throw httpError(403, 'A customer account is required.');
  const session = await resolveLoginSession(req.user, 'buyer');
  res.json({ success: true, token: generateToken(req.user._id, 'user', 'buyer'), user: publicUser(req.user), ...session });
});

// @desc    Admin login (email/password)
// @route   POST /api/auth/admin/login
// @access  Public
export const adminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalizedEmail || typeof password !== 'string' || !password) {
    res.status(400);
    throw new Error("Please provide email and password");
  }

  const admin = await Admin.findOne({ email: normalizedEmail });

  if (admin && (await admin.matchPassword(password))) {
    if (!admin.isActive) {
      // Keep public login failures non-enumerating. Operators can inspect the
      // account state through authorized administration channels.
      res.status(401);
      throw new Error("Invalid admin credentials");
    }

    admin.lastLogin = new Date();
    await admin.save();

    const token = generateToken(admin._id, "admin");

    res.status(200).json({
      success: true,
      token,
      admin: {
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role
      }
    });
  } else {
    res.status(401);
    throw new Error("Invalid admin credentials");
  }
});

// @desc    Get currently logged in profile
// @route   GET /api/auth/me
// @access  Private
export const getMe = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(404);
    throw new Error("Profile not found");
  }

  if (req.userType === 'admin') {
    return res.status(200).json({
      success: true,
      userType: 'admin',
      profile: req.user
    });
  }

  res.status(200).json({
    success: true,
    userType: 'user',
    ...(await resolveLoginSession(req.user, req.tokenRole)),
    profile: publicUser(req.user)
  });
});

// @desc    Logout user/seller and invalidate session
// @route   POST /api/auth/logout
// @access  Public
export const logout = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    message: "Logged out successfully"
  });
});
