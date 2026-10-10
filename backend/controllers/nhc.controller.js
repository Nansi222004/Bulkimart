import mongoose from "mongoose";
import NHCPlan, { seedInitialNhcPlans } from "../models/NHCPlan.js";
import Seller from "../models/Seller.js";
import User from "../models/User.js";
import { asyncHandler } from "../middlewares/error.middleware.js";
import { ok, httpError, paginated, getPagination } from "../utils/response.js";
import { ROLE, VENDOR_STATUS } from "../constants/enums.js";

// Call seed check on startup
seedInitialNhcPlans();

/* ============================================================================
 * SELLER / PUBLIC NHC PLAN ENDPOINTS
 * ========================================================================== */

/**
 * @desc    Get active NHC seller plans for onboarding
 * @route   GET /api/nhc/plans
 * @access  Public / Authenticated
 */
export const getActivePlans = asyncHandler(async (req, res) => {
  const plans = await NHCPlan.find({ isActive: true }).sort({ amount: 1 }).lean();

  const formattedPlans = plans.map((p) => ({
    id: p._id.toString(),
    _id: p._id.toString(),
    planType: p.planType,
    name: p.name,
    amount: p.amount,
    currency: p.currency || "INR",
    description: p.description || "",
    isActive: p.isActive,
  }));

  return ok(res, formattedPlans, "Active NHC seller plans retrieved successfully");
});

/**
 * @desc    Select an NHC seller plan & store immutable snapshot
 * @route   POST /api/nhc/seller/select-plan
 * @access  Private (Seller User)
 */
export const selectPlan = asyncHandler(async (req, res) => {
  const { planId } = req.body;

  if (!planId || !mongoose.Types.ObjectId.isValid(planId)) {
    throw httpError(400, "Please provide a valid NHC Plan ID");
  }

  const seller = await Seller.findOne({ userId: req.user._id });
  if (!seller) {
    throw httpError(404, "Seller profile not found. Please complete step 1 of onboarding.");
  }

  if (!seller.isNscSeller) {
    throw httpError(400, "Plan selection is only available for NHC Organization Sellers.");
  }

  const plan = await NHCPlan.findById(planId);
  if (!plan) {
    throw httpError(404, "Selected NHC plan does not exist");
  }

  if (!plan.isActive) {
    throw httpError(400, "The selected NHC plan is currently inactive. Please choose an active plan.");
  }

  // Mandatory Rule: Save immutable SNAPSHOT of the plan on the seller document
  seller.nhcPlan = {
    planId: plan._id,
    planType: plan.planType,
    planName: plan.name,
    planAmount: plan.amount, // Snapshot of amount at selection time
    currency: plan.currency || "INR",
    description: plan.description || "",
    selectedAt: new Date(),
  };

  if (seller.onboardingStep < 9) {
    seller.onboardingStep = 9;
  }

  await seller.save();

  return ok(
    res,
    {
      sellerId: seller._id,
      onboardingStep: seller.onboardingStep,
      nhcPlan: seller.nhcPlan,
    },
    `Selected plan ${plan.name} (Snapshot Amount: ₹${plan.amount.toLocaleString("en-IN")})`
  );
});

/**
 * @desc    Submit NHC Seller application for review
 * @route   POST /api/nhc/seller/submit-application
 * @access  Private (Seller User)
 */
export const submitNhcApplication = asyncHandler(async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user._id });
  if (!seller) {
    throw httpError(404, "Seller profile not found");
  }

  if (seller.isNscSeller && (!seller.nhcPlan || !seller.nhcPlan.planId)) {
    throw httpError(400, "Please select an NHC Plan before submitting your application");
  }

  seller.status = "under_review";
  seller.submittedAt = seller.submittedAt || new Date();
  await seller.save();

  return ok(
    res,
    {
      sellerId: seller._id,
      status: seller.status,
      submittedAt: seller.submittedAt,
      nhcPlan: seller.nhcPlan,
    },
    "NHC Seller application submitted successfully for admin review"
  );
});

/**
 * @desc    Get current NHC seller application status & plan snapshot
 * @route   GET /api/nhc/seller/application
 * @access  Private (Seller User)
 */
export const getSellerNhcApplication = asyncHandler(async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user._id }).populate("userId", "name phone email");
  if (!seller) {
    throw httpError(404, "Seller profile not found");
  }

  return ok(res, {
    applicationId: seller._id,
    status: seller.status,
    isNscSeller: seller.isNscSeller,
    storeName: seller.storeDetails?.name || seller.businessName,
    submittedAt: seller.submittedAt || seller.updatedAt,
    nhcPlan: seller.nhcPlan || null,
    rejectionReason: seller.rejectionReason || null,
    approvedAt: seller.approvedAt || null,
  });
});

/* ============================================================================
 * ADMIN NHC PLAN MANAGEMENT ENDPOINTS
 * ========================================================================== */

/**
 * @desc    Get all NHC plans (active and inactive) for Admin
 * @route   GET /api/admin/nhc/plans
 * @access  Private/Admin
 */
export const getAdminPlans = asyncHandler(async (req, res) => {
  const plans = await NHCPlan.find().sort({ createdAt: -1 }).lean();
  return ok(res, plans);
});

/**
 * @desc    Create a new NHC seller plan
 * @route   POST /api/admin/nhc/plans
 * @access  Private/Admin
 */
export const createAdminPlan = asyncHandler(async (req, res) => {
  const { name, planType, amount, currency, description, isActive } = req.body;

  if (!name || amount === undefined || amount === null) {
    throw httpError(400, "Plan name and amount are required");
  }

  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount < 0) {
    throw httpError(400, "Plan amount must be a valid non-negative number");
  }

  const plan = await NHCPlan.create({
    name: name.trim(),
    planType: planType || "UNIT_SELLER",
    amount: numAmount,
    currency: currency || "INR",
    description: description ? description.trim() : "",
    isActive: isActive !== undefined ? Boolean(isActive) : true,
    createdBy: req.user._id,
  });

  return ok(res, plan, "NHC plan created successfully");
});

/**
 * @desc    Update an existing NHC plan (Does NOT affect past application snapshots)
 * @route   PATCH /api/admin/nhc/plans/:id
 * @access  Private/Admin
 */
export const updateAdminPlan = asyncHandler(async (req, res) => {
  const plan = await NHCPlan.findById(req.params.id);
  if (!plan) {
    throw httpError(404, "NHC plan not found");
  }

  const { name, planType, amount, currency, description, isActive } = req.body;

  if (name !== undefined) plan.name = name.trim();
  if (planType !== undefined) plan.planType = planType;
  if (amount !== undefined) {
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount < 0) {
      throw httpError(400, "Plan amount must be a valid non-negative number");
    }
    plan.amount = numAmount;
  }
  if (currency !== undefined) plan.currency = currency;
  if (description !== undefined) plan.description = description.trim();
  if (isActive !== undefined) plan.isActive = Boolean(isActive);

  plan.updatedBy = req.user._id;
  await plan.save();

  return ok(res, plan, "NHC plan updated successfully. Note: Past applications retain their original snapshot amounts.");
});

/**
 * @desc    Toggle active status of an NHC plan
 * @route   PATCH /api/admin/nhc/plans/:id/status
 * @access  Private/Admin
 */
export const toggleAdminPlanStatus = asyncHandler(async (req, res) => {
  const plan = await NHCPlan.findById(req.params.id);
  if (!plan) {
    throw httpError(404, "NHC plan not found");
  }

  const { isActive } = req.body;
  plan.isActive = isActive !== undefined ? Boolean(isActive) : !plan.isActive;
  plan.updatedBy = req.user._id;
  await plan.save();

  return ok(res, plan, `Plan ${plan.name} status updated to ${plan.isActive ? "Active" : "Inactive"}`);
});

/* ============================================================================
 * ADMIN NHC SELLER APPLICATIONS ENDPOINTS
 * ========================================================================== */

/**
 * @desc    List NHC Seller Applications with filters
 * @route   GET /api/admin/nhc/seller-applications
 * @access  Private/Admin
 */
export const getAdminNhcApplications = asyncHandler(async (req, res) => {
  const { status, planType, search } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  const filter = { isNscSeller: true };

  if (status && status !== "all") {
    filter.status = status;
  }

  if (planType && planType !== "all") {
    filter["nhcPlan.planType"] = planType;
  }

  if (search) {
    const rx = new RegExp(search, "i");
    filter.$or = [
      { businessName: rx },
      { "storeDetails.name": rx },
      { "storeDetails.city": rx },
      { "nhcPlan.planName": rx },
    ];
  }

  const [sellers, total] = await Promise.all([
    Seller.find(filter)
      .populate("userId", "phone name email")
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Seller.countDocuments(filter),
  ]);

  const defaultPlan = {
    planType: "UNIT_SELLER",
    planName: "Unit Seller",
    planAmount: 1000000,
    currency: "INR",
    description: "Standard NHC Unit Seller membership with local operational coverage.",
    selectedAt: new Date(),
  };

  const rows = sellers.map((s) => {
    const activePlan = (s.nhcPlan && s.nhcPlan.planName) ? s.nhcPlan : defaultPlan;
    return {
      _id: s._id,
      sellerId: s._id,
      businessName: s.businessName,
      storeName: s.storeDetails?.name || s.businessName,
      sellerCategory: "NHC Organization Seller",
      holderName: s.userId?.name || s.bankDetails?.holderName || "—",
      phone: s.userId?.phone,
      email: s.userId?.email,
      city: s.storeDetails?.city || "—",
      state: s.storeDetails?.state || "—",
      pincode: s.storeDetails?.pincode || "—",
      status: s.status,
      submittedAt: s.submittedAt || s.updatedAt,
      approvedAt: s.approvedAt,
      rejectedAt: s.rejectedAt,
      rejectionReason: s.rejectionReason,

      // SNAPSHOT DATA
      nhcPlan: {
        planId: activePlan.planId,
        planType: activePlan.planType || "UNIT_SELLER",
        planName: activePlan.planName || "Unit Seller",
        planAmount: activePlan.planAmount || 1000000,
        currency: activePlan.currency || "INR",
        selectedAt: activePlan.selectedAt || s.createdAt || s.updatedAt,
      },
    };
  });

  return paginated(res, rows, { page, limit, total });
});

/**
 * @desc    Get detailed view of a single NHC Seller Application
 * @route   GET /api/admin/nhc/seller-applications/:id
 * @access  Private/Admin
 */
export const getAdminNhcApplicationDetail = asyncHandler(async (req, res) => {
  const seller = await Seller.findById(req.params.id)
    .populate("userId", "phone name email avatar createdAt isActive")
    .populate("approvedBy", "name email")
    .populate("rejectedBy", "name email");

  if (!seller) {
    throw httpError(404, "NHC seller application not found");
  }

  // Auto-backfill if missing
  if (seller.isNscSeller && (!seller.nhcPlan || !seller.nhcPlan.planName)) {
    seller.nhcPlan = {
      planType: "UNIT_SELLER",
      planName: "Unit Seller",
      planAmount: 1000000,
      currency: "INR",
      description: "Standard NHC Unit Seller membership with local operational coverage.",
      selectedAt: seller.createdAt || seller.updatedAt || new Date(),
    };
    await seller.save();
  }

  return ok(res, {
    _id: seller._id,
    sellerId: seller._id,
    isNscSeller: seller.isNscSeller,
    status: seller.status,
    onboardingStep: seller.onboardingStep,
    submittedAt: seller.submittedAt || seller.updatedAt,
    approvedAt: seller.approvedAt,
    approvedBy: seller.approvedBy?.name,
    rejectedAt: seller.rejectedAt,
    rejectedBy: seller.rejectedBy?.name,
    rejectionReason: seller.rejectionReason,
    nhcPlan: seller.nhcPlan,

    // Account Identity
    account: {
      userId: seller.userId?._id,
      phone: seller.userId?.phone,
      name: seller.userId?.name,
      email: seller.userId?.email,
      isActive: seller.userId?.isActive,
      joinedAt: seller.userId?.createdAt,
    },

    // Business Profile
    business: {
      businessName: seller.businessName,
      businessType: seller.businessType,
      store: seller.storeDetails,
      isNscSeller: seller.isNscSeller,
    },

    // Location
    location: {
      address: seller.storeDetails?.address,
      city: seller.storeDetails?.city,
      state: seller.storeDetails?.state,
      pincode: seller.storeDetails?.pincode,
      lat: seller.storeDetails?.lat,
      lng: seller.storeDetails?.lng,
    },

    // KYC Data
    aadhaar: seller.aadhaar,
    bank: seller.bankDetails,
    legal: {
      gstin: seller.gstin,
      pan: seller.pan,
      fssai: seller.fssai,
      tradeLicense: seller.tradeLicense,
      documents: seller.documents,
    },

    // Flattened Documents for UI preview
    documents: [
      { label: "Aadhaar Front", url: seller.aadhaar?.frontUrl, category: "KYC" },
      { label: "Aadhaar Back", url: seller.aadhaar?.backUrl, category: "KYC" },
      { label: "Bank Passbook", url: seller.bankDetails?.passbookUrl, category: "Bank" },
      ...(seller.documents || []).map((d) => ({ label: d.type, url: d.url, category: "Legal" })),
    ].filter((d) => d.url),

    // NHC PLAN SNAPSHOT (MANDATORY REQUIREMENT)
    nhcPlan: seller.nhcPlan
      ? {
          planId: seller.nhcPlan.planId,
          planType: seller.nhcPlan.planType,
          planName: seller.nhcPlan.planName,
          planAmount: seller.nhcPlan.planAmount,
          currency: seller.nhcPlan.currency || "INR",
          description: seller.nhcPlan.description,
          selectedAt: seller.nhcPlan.selectedAt,
        }
      : null,
  });
});

/**
 * @desc    Approve an NHC Seller Application
 * @route   PATCH /api/admin/nhc/seller-applications/:id/approve
 * @access  Private/Admin
 */
export const approveNhcApplication = asyncHandler(async (req, res) => {
  const seller = await Seller.findById(req.params.id);
  if (!seller) {
    throw httpError(404, "NHC seller application not found");
  }

  if (seller.status === VENDOR_STATUS.APPROVED) {
    throw httpError(400, "Seller application is already approved");
  }

  seller.status = VENDOR_STATUS.APPROVED;
  seller.approvedAt = new Date();
  seller.approvedBy = req.user._id;
  seller.rejectionReason = undefined;
  await seller.save();

  // Grant the 'seller' role to unlock the seller dashboard
  await User.updateOne({ _id: seller.userId }, { $set: { role: ROLE.SELLER, isSeller: true } });

  return ok(
    res,
    {
      sellerId: seller._id,
      status: seller.status,
      approvedAt: seller.approvedAt,
    },
    `NHC Seller "${seller.businessName || seller.storeDetails?.name}" application approved successfully`
  );
});

/**
 * @desc    Reject an NHC Seller Application
 * @route   PATCH /api/admin/nhc/seller-applications/:id/reject
 * @access  Private/Admin
 */
export const rejectNhcApplication = asyncHandler(async (req, res) => {
  const { rejectionReason } = req.body;
  if (!rejectionReason || !rejectionReason.trim()) {
    throw httpError(400, "Please provide a valid rejection reason");
  }

  const seller = await Seller.findById(req.params.id);
  if (!seller) {
    throw httpError(404, "NHC seller application not found");
  }

  seller.status = VENDOR_STATUS.REJECTED;
  seller.rejectedAt = new Date();
  seller.rejectedBy = req.user._id;
  seller.rejectionReason = rejectionReason.trim();
  await seller.save();

  return ok(
    res,
    {
      sellerId: seller._id,
      status: seller.status,
      rejectionReason: seller.rejectionReason,
      rejectedAt: seller.rejectedAt,
    },
    `NHC Seller application rejected.`
  );
});
