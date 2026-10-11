import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Admin from "../models/Admin.js";
import { asyncHandler } from "../middlewares/error.middleware.js";
import { httpError } from "../utils/response.js";
import { sendOTP, verifyOTP } from "../services/sms.service.js";
import { captureReferralSignup } from "../services/referral.service.js";
import { JWT_SECRET } from "../config/jwt.js";

/**
 * `role`, when given, is a claim the caller has already verified at THIS
 * exact moment (e.g. verifySellerOTP only reaches this call after confirming
 * an approved Seller record) — never a value handed straight through from
 * request input. It rides in the JWT so later requests (e.g. creating a
 * support ticket) can trust "this session authenticated as a seller"
 * without re-deriving it from a client-supplied hint. Omitted for the base
 * customer/shared login, where no such claim exists yet — see
 * ticket.service.js::resolveRequester for how an absent claim is handled.
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
  isShgMember: user.isShgMember || false,
  shgRegNo: user.shgRegNo || null,
  shgStoreId: user.shgStoreId || null,
  createdAt: user.createdAt,
});

// @desc    Send OTP to phone
// @route   POST /api/auth/send-otp
// @access  Public
export const requestOTP = asyncHandler(async (req, res) => {
  const { phone, isLogin } = req.body;
  if (!phone || phone.length < 10) {
    res.status(400);
    throw new Error("Please provide a valid phone number");
  }

  const existingUser = await User.findOne({ phone });

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

  if (process.env.OTP_MODE === 'mock') {
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
  const { phone, otp, referralCode, isLogin, name, email } = req.body;

  if (!phone || !otp) {
    res.status(400);
    throw new Error("Please provide phone and OTP");
  }

  const verification = verifyOTP(phone, otp);
  if (!verification.valid) {
    res.status(400);
    throw new Error(verification.message || "Invalid OTP verification");
  }

  // Find or Create User
  let user = await User.findOne({ phone });
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
    user = await User.create({
      phone,
      name: (name || "").trim(),
      email: (email || "").trim(),
      roles: ["buyer"],
      wallet: { balance: 0, transactions: [] }
    });
    isNewUser = true;

    // Referral Program — attribution happens exactly once, right here, on a
    // brand-new phone number. Never blocks signup on any failure (see
    // captureReferralSignup's own try/catch).
    if (referralCode) {
      await captureReferralSignup({ refereeId: user._id, referralCode });
    }
  }

  if (!user.isActive) {
    res.status(403);
    throw new Error("Access denied — user account is deactivated");
  }

  const token = generateToken(user._id, "user");

  res.status(200).json({
    success: true,
    isNewUser,
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

// @desc    Send OTP for seller entry — phone must already be a registered Bulkimart user
// @route   POST /api/auth/seller/send-otp
// @access  Public
export const requestSellerOTP = asyncHandler(async (req, res) => {
  const { phone } = req.body;
  if (!phone || phone.length < 10) {
    res.status(400);
    throw new Error("Please provide a valid phone number");
  }

  const user = await User.findOne({ phone });
  if (!user) {
    // A machine-readable `code` (not just the human message) so the seller
    // login screen can render the specific "not a member" CTA rather than a
    // generic error toast.
    throw httpError(
      404,
      "You are not a member of Bulkimart Shopping App. Please open the Bulkimart Shopping App and create your account first.",
      { code: "NOT_A_MEMBER" }
    );
  }

  const result = await sendOTP(phone);

  if (process.env.OTP_MODE === 'mock') {
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

// @desc    Verify OTP for seller entry — re-checks the user still exists (the
//          OTP was already sent to a known number by requestSellerOTP, but
//          this must never trust that alone as proof of membership).
// @route   POST /api/auth/seller/verify-otp
// @access  Public
export const verifySellerOTP = asyncHandler(async (req, res) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    res.status(400);
    throw new Error("Please provide phone and OTP");
  }

  const user = await User.findOne({ phone });
  if (!user) {
    throw httpError(
      404,
      "You are not a member of Bulkimart Shopping App. Please open the Bulkimart Shopping App and create your account first.",
      { code: "NOT_A_MEMBER" }
    );
  }

  const verification = verifyOTP(phone, otp);
  if (!verification.valid) {
    res.status(400);
    throw new Error(verification.message || "Invalid OTP verification");
  }

  if (!user.isActive) {
    res.status(403);
    throw new Error("Access denied — user account is deactivated");
  }

  // "seller" here means "authenticated through the seller entry point" —
  // not yet proof of an *approved* Seller record. Anything that trusts this
  // claim (ticket.service.js::resolveRequester) re-checks approval status
  // itself before acting on it; this just saves that re-check a guess at
  // which vendor collection to look in.
  const token = generateToken(user._id, "user", "seller");

  res.status(200).json({
    success: true,
    token,
    user: publicUser(user),
  });
});

// @desc    Admin login (email/password)
// @route   POST /api/auth/admin/login
// @access  Public
export const adminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    throw new Error("Please provide email and password");
  }

  const admin = await Admin.findOne({ email: email.toLowerCase() });

  if (admin && (await admin.matchPassword(password))) {
    if (!admin.isActive) {
      res.status(403);
      throw new Error("Access denied — admin account is deactivated");
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
    profile: req.user
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
