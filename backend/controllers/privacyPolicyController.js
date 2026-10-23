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
    const slug = String(req.params.slug || req.params.identifier || '').trim().toLowerCase();

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
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ success: false, message: 'A privacy policy object is required' });
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
    const invalid = message => res.status(400).json({ success: false, message });
    if (roleTitle !== undefined && (typeof roleTitle !== 'string' || !roleTitle.trim())) return invalid('Policy title is required');
    if (summary !== undefined && typeof summary !== 'string') return invalid('Policy summary must be text');
    if (version !== undefined && (typeof version !== 'string' || !version.trim())) return invalid('Policy version is required');
    if (isPublished !== undefined && typeof isPublished !== 'boolean') return invalid('Published status must be true or false');
    if (effectiveDate !== undefined && (!effectiveDate || Number.isNaN(new Date(effectiveDate).getTime()) || (typeof effectiveDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) && new Date(effectiveDate).toISOString().slice(0,10) !== effectiveDate))) return invalid('Enter a valid effective date');
    if (sections !== undefined) {
      if (!Array.isArray(sections)) return invalid('Policy sections must be a list');
      for (let index = 0; index < sections.length; index++) {
        const section = sections[index];
        if (!section || typeof section.title !== 'string' || !section.title.trim()) return invalid(`Section ${index + 1}: title is required`);
        if (typeof section.content !== 'string' || !section.content.trim()) return invalid(`Section ${index + 1}: content is required`);
        if (section.points !== undefined && (!Array.isArray(section.points) || section.points.some(point => typeof point !== 'string'))) return invalid(`Section ${index + 1}: bullet points must be text`);
      }
    }

    let policy = await PrivacyPolicy.findOne({ role: targetRole });

    const updatedData = {
      role: targetRole,
      roleTitle: roleTitle?.trim() || policy?.roleTitle || `${targetRole.toUpperCase()} Privacy Policy`,
      slug: targetSlug,
      summary: summary !== undefined ? summary : policy?.summary || "",
      sections: Array.isArray(sections) ? sections.map((section, index) => ({ ...section, title: section.title.trim(), content: section.content.trim(), order: index + 1 })) : policy?.sections || [],
      version: version || policy?.version || "1.0.0",
      effectiveDate: effectiveDate !== undefined ? effectiveDate : policy?.effectiveDate || Date.now(),
      lastUpdatedBy: req.admin?._id || req.user?._id || null,
      isPublished: isPublished !== undefined ? isPublished : policy?.isPublished ?? true,
    };

    if (policy) {
      policy = await PrivacyPolicy.findOneAndUpdate(
        { role: targetRole },
        { $set: updatedData },
        { returnDocument: 'after', runValidators: true }
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
    const status = error.code === 11000 ? 409 : ['ValidationError', 'CastError'].includes(error.name) ? 400 : 500;
    res.status(status).json({
      success: false,
      message: status === 409 ? 'Policy changed or its route is already in use. Reload before saving.' : status === 400 ? `Invalid privacy policy: ${error.message}` : 'Failed to update privacy policy. Please try again.',
    });
  }
};
