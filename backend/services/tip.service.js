import TipSetting from '../models/TipSetting.js';

const TTL_MS = 60_000;
let cache = null;
let cachedAt = 0;

const DEFAULTS = () => ({
  isEnabled: true,
  title: 'Tip your delivery partner',
  subtitle: "100% of your tip goes to them. We don't take a cut.",
  options: [10, 20, 30, 40, 50],
  allowCustom: true,
  minCustomAmount: 1,
  maxCustomAmount: 1000,
});

export const loadTipSetting = async () => {
  const row = await TipSetting.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
  cache = row
    ? {
        _id: row._id,
        isEnabled: row.isEnabled,
        title: row.title || 'Tip your delivery partner',
        subtitle: row.subtitle || "100% of your tip goes to them. We don't take a cut.",
        options: Array.isArray(row.options) && row.options.length > 0 ? row.options : [10, 20, 30, 40, 50],
        allowCustom: row.allowCustom ?? true,
        minCustomAmount: row.minCustomAmount ?? 1,
        maxCustomAmount: row.maxCustomAmount ?? 1000,
      }
    : DEFAULTS();
  cachedAt = Date.now();
  return cache;
};

export const invalidateTipSetting = () => {
  cache = null;
  cachedAt = 0;
};

export const getTipSetting = () => {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  return cache || DEFAULTS();
};

/**
 * Validates a client-requested tip amount against live tip settings.
 * Returns the numeric tip amount if valid, 0 if absent, or throws 400 if invalid.
 */
export const resolveTip = (requestedAmount) => {
  if (requestedAmount === undefined || requestedAmount === null || requestedAmount === '' || requestedAmount === 0) {
    return 0;
  }

  const amount = Number(requestedAmount);
  if (!Number.isFinite(amount) || amount < 0) {
    const err = new Error('That tip amount is not available right now.');
    err.status = 400;
    throw err;
  }

  if (amount === 0) return 0;

  const setting = getTipSetting();
  if (!setting.isEnabled) {
    const err = new Error('That tip amount is not available right now.');
    err.status = 400;
    throw err;
  }

  const isPreset = (setting.options || [10, 20, 30, 40, 50]).some((o) => Number(o) === amount);
  const isValidCustom = Boolean(setting.allowCustom)
    && Number.isInteger(amount)
    && amount >= (setting.minCustomAmount ?? 1)
    && amount <= (setting.maxCustomAmount ?? 1000);

  if (!isPreset && !isValidCustom) {
    const err = new Error('That tip amount is not available right now.');
    err.status = 400;
    throw err;
  }

  return amount;
};

