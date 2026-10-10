import PrivacyPolicy from "../models/PrivacyPolicy.js";

const ROLE_SLUG_MAP = {
  user: "user-policy",
  seller: "seller-policy",
  delivery: "delivery-policy",
  shg: "shg-policy",
};

const SLUG_ROLE_MAP = {
  "user-policy": "user",
  "seller-policy": "seller",
  "delivery-policy": "delivery",
  "shg-policy": "shg",
};

// @desc    Get all privacy policies for all roles
// @route   GET /api/privacy-policy
// @access  Public
export const getAllPolicies = async (req, res) => {
  try {
    const policies = await PrivacyPolicy.find().sort({ role: 1 });
    res.json({
      success: true,
      count: policies.length,
      data: policies,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch privacy policies",
      error: error.message,
    });
  }
};

// @desc    Get privacy policy by role identifier (user, seller, delivery, shg)
// @route   GET /api/privacy-policy/role/:roleKey
// @access  Public
export const getPolicyByRole = async (req, res) => {
  try {
    const { roleKey } = req.params;
    const normalizedRole = (roleKey || "").toLowerCase();

    if (!["user", "seller", "delivery", "shg"].includes(normalizedRole)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role specified. Supported roles: user, seller, delivery, shg",
      });
    }

    let policy = await PrivacyPolicy.findOne({ role: normalizedRole });

    if (!policy) {
      return res.status(404).json({
        success: false,
        message: `Privacy policy for role '${normalizedRole}' not found`,
      });
    }

    res.json({
      success: true,
      data: policy,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch privacy policy",
      error: error.message,
    });
  }
};

// @desc    Get privacy policy by explicit slug route name (user-policy, seller-policy, delivery-policy, shg-policy)
// @route   GET /api/privacy-policy/:slug
// @access  Public
export const getPolicyBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    // Check if parameter is a role or slug
    let role = SLUG_ROLE_MAP[slug] || slug;

    let policy = await PrivacyPolicy.findOne({
      $or: [{ slug: slug }, { role: role }],
    });

    if (!policy) {
      return res.status(404).json({
        success: false,
        message: `Privacy policy route '${slug}' not found`,
      });
    }

    res.json({
      success: true,
      data: policy,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch privacy policy by route",
      error: error.message,
    });
  }
};

// @desc    Update or publish privacy policy for a specific role/slug (Admin only)
// @route   PUT /api/admin/privacy-policy/:identifier
// @access  Private (Admin)
export const updatePolicy = async (req, res) => {
  try {
    const { identifier } = req.params;
    const { roleTitle, summary, sections, version, effectiveDate, isPublished } = req.body;

    const normalizedId = (identifier || "").toLowerCase();
    const targetRole = SLUG_ROLE_MAP[normalizedId] || (["user", "seller", "delivery", "shg"].includes(normalizedId) ? normalizedId : null);

    if (!targetRole) {
      return res.status(400).json({
        success: false,
        message: "Invalid route/role identifier. Allowed: user, seller, delivery, shg (or user-policy, seller-policy, delivery-policy, shg-policy)",
      });
    }

    const targetSlug = ROLE_SLUG_MAP[targetRole];

    let policy = await PrivacyPolicy.findOne({ role: targetRole });

    const updatedData = {
      role: targetRole,
      roleTitle: roleTitle || `${targetRole.toUpperCase()} Privacy Policy`,
      slug: targetSlug,
      summary: summary !== undefined ? summary : policy?.summary || "",
      sections: Array.isArray(sections) ? sections : policy?.sections || [],
      version: version || policy?.version || "1.0.0",
      effectiveDate: effectiveDate || Date.now(),
      lastUpdatedBy: req.admin?._id || req.user?._id || null,
      isPublished: isPublished !== undefined ? isPublished : true,
    };

    if (policy) {
      policy = await PrivacyPolicy.findOneAndUpdate(
        { role: targetRole },
        { $set: updatedData },
        { new: true, runValidators: true }
      );
    } else {
      policy = await PrivacyPolicy.create(updatedData);
    }

    res.json({
      success: true,
      message: `Privacy policy for ${targetRole} updated successfully!`,
      data: policy,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update privacy policy",
      error: error.message,
    });
  }
};
