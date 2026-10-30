import HelplineSetting from "../models/HelplineSetting.js";

export const DEFAULT_HELPLINE_CONFIG = {
  sosEmergencyNumber: "112",
  bulkimartHelplineNumber: "1800-111-2233",
  sellerHelplineNumber: "1800-111-2233",
  riderHelplineNumber: "1800-111-2233",
  description: "Default platform emergency and helpline settings",
};

let cachedSetting = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60000; // 1 minute in-memory cache

export const invalidateHelplineCache = () => {
  cachedSetting = null;
  lastFetchTime = 0;
};

/**
 * Clean & normalize a phone / helpline string for dialing tel:
 */
export const sanitizeDialNumber = (raw) => {
  if (!raw || typeof raw !== "string") return "";
  return raw.replace(/[^0-9+]/g, "");
};

/**
 * Load active helpline configuration (public read).
 */
export const getActiveHelplineSetting = async () => {
  const now = Date.now();
  if (cachedSetting && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedSetting;
  }

  const row = await HelplineSetting.findOne({ isActive: true })
    .sort({ createdAt: -1 })
    .lean();

  const config = row
    ? {
        id: String(row._id),
        sosEmergencyNumber: row.sosEmergencyNumber || DEFAULT_HELPLINE_CONFIG.sosEmergencyNumber,
        bulkimartHelplineNumber: row.bulkimartHelplineNumber || DEFAULT_HELPLINE_CONFIG.bulkimartHelplineNumber,
        sellerHelplineNumber: row.sellerHelplineNumber || DEFAULT_HELPLINE_CONFIG.sellerHelplineNumber,
        riderHelplineNumber: row.riderHelplineNumber || DEFAULT_HELPLINE_CONFIG.riderHelplineNumber,
        description: row.description || DEFAULT_HELPLINE_CONFIG.description,
        updatedAt: row.updatedAt,
      }
    : { ...DEFAULT_HELPLINE_CONFIG };

  cachedSetting = config;
  lastFetchTime = now;
  return config;
};

/**
 * Get active setting plus recent history for Admin.
 */
export const getHelplineSettingForAdmin = async () => {
  const active = await HelplineSetting.findOne({ isActive: true })
    .sort({ createdAt: -1 })
    .populate("updatedBy", "name email role")
    .lean();

  const history = await HelplineSetting.find()
    .sort({ createdAt: -1 })
    .limit(10)
    .populate("updatedBy", "name email role")
    .lean();

  return {
    active: active || { ...DEFAULT_HELPLINE_CONFIG, isActive: true },
    history: history || [],
    defaults: DEFAULT_HELPLINE_CONFIG,
  };
};

/**
 * Update helpline configuration from Admin.
 */
export const saveHelplineSettingFromAdmin = async ({
  sosEmergencyNumber,
  bulkimartHelplineNumber,
  sellerHelplineNumber,
  riderHelplineNumber,
  description,
  adminUserId,
}) => {
  // Validate at least some digits in numbers
  const validatePhone = (num, name) => {
    if (!num || typeof num !== "string" || !/[0-9]/.test(num)) {
      throw new Error(`Invalid ${name}: must contain valid numeric digits.`);
    }
    if (num.length > 30) {
      throw new Error(`${name} must be 30 characters or fewer.`);
    }
  };

  validatePhone(sosEmergencyNumber || "112", "SOS Emergency Number");
  validatePhone(bulkimartHelplineNumber || "1800-111-2233", "Bulkimart Helpline");
  validatePhone(sellerHelplineNumber || "1800-111-2233", "Seller Helpline");
  validatePhone(riderHelplineNumber || "1800-111-2233", "Rider Helpline");

  // Deactivate existing settings
  await HelplineSetting.updateMany({ isActive: true }, { $set: { isActive: false } });

  // Create new active setting
  const created = await HelplineSetting.create({
    sosEmergencyNumber: (sosEmergencyNumber || "112").trim(),
    bulkimartHelplineNumber: (bulkimartHelplineNumber || "1800-111-2233").trim(),
    sellerHelplineNumber: (sellerHelplineNumber || "1800-111-2233").trim(),
    riderHelplineNumber: (riderHelplineNumber || "1800-111-2233").trim(),
    description: (description || "Updated platform helpline settings").trim(),
    isActive: true,
    updatedBy: adminUserId || null,
  });

  invalidateHelplineCache();
  return created;
};
