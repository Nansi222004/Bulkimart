import { httpError } from '../utils/response.js';
import { RETURN_REASON } from '../constants/enums.js';

/**
 * Easy Returns — a seller-priced return option chosen by the customer per cart line.
 *
 *   NO_EASY_RETURN  the product's normal price; returns only for a wrong, damaged or defective item.
 *   EASY_RETURN     normal price + the seller's extra charge; returns for any listed reason.
 *
 * Both options use the seller's return window. Everything the order needs is frozen on the
 * order item at checkout, so later product edits never change an existing order's terms.
 * Products without `easyReturns.enabled` keep the existing category/product return policy.
 */
export const RETURN_OPTION = { EASY_RETURN: 'EASY_RETURN', NO_EASY_RETURN: 'NO_EASY_RETURN' };
export const RETURN_OPTIONS = Object.values(RETURN_OPTION);

/** Reasons a NO_EASY_RETURN item may still be returned for. */
export const RESTRICTED_RETURN_REASONS = [RETURN_REASON.WRONG_PRODUCT, RETURN_REASON.DAMAGED, RETURN_REASON.DEFECTIVE];

export const EASY_RETURN_LIMITS = { maxWindowDays: 90, maxExtraCharge: 100000, maxPolicyLength: 1000, maxConditions: 10, maxConditionLength: 200 };

const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const easyReturnsEnabled = (product) => Boolean(product?.easyReturns?.enabled)
  && product?.fulfillmentType !== 'digital';

export const defaultEasyReturnsPolicy = (days) => `Return for any reason within ${days} day${days === 1 ? '' : 's'} of delivery. Without Easy Returns, only a wrong, damaged or defective item can be returned.`;

/**
 * Validates the seller form value. Returns the config to store, null to clear, or undefined when not sent.
 * Easy Returns sits inside "Allow Returns": it needs returns switched on and uses the product's own
 * return window (`context.windowDays`, resolved by the caller from the product/category policy).
 * Only the extra charge is required; the policy text defaults to a standard sentence.
 */
export function parseEasyReturnsConfig(raw, product = {}, context = {}) {
  if (raw === undefined) return undefined;
  let value = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return null;
    try { value = JSON.parse(raw); } catch { throw httpError(400, 'Easy Returns settings are invalid'); }
  }
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'Easy Returns settings are invalid');
  const enabled = value.enabled === true || value.enabled === 'true';
  if (!enabled) return { enabled: false };
  if (product.fulfillmentType === 'digital') throw httpError(400, 'Easy Returns is available only for physical products');
  if (context.returnsEnabled === false) throw httpError(400, 'Turn on Allow Returns to offer Easy Returns');

  const extraCharge = Number(value.extraCharge);
  if (value.extraCharge === '' || value.extraCharge == null || !Number.isFinite(extraCharge) || extraCharge < 0 || extraCharge > EASY_RETURN_LIMITS.maxExtraCharge) {
    throw httpError(400, 'Enter a valid Easy Returns extra charge (0 or more)');
  }
  if (Math.round(extraCharge * 100) !== extraCharge * 100) throw httpError(400, 'Easy Returns extra charge can have at most 2 decimal places');

  // The product's return window wins; an explicit value is only used when no window can be resolved.
  const windowDays = Number(context.windowDays ?? value.windowDays);
  if (!Number.isSafeInteger(windowDays) || windowDays < 1) {
    throw httpError(400, 'Easy Returns needs a return window. Set one under Allow Returns, or ask Admin to enable the category/global return policy');
  }
  if (windowDays > EASY_RETURN_LIMITS.maxWindowDays) throw httpError(400, `Return window can be at most ${EASY_RETURN_LIMITS.maxWindowDays} days for Easy Returns`);

  const policyText = String(value.policyText ?? '').trim() || defaultEasyReturnsPolicy(windowDays);
  if (policyText.length > EASY_RETURN_LIMITS.maxPolicyLength) throw httpError(400, `Return policy can be at most ${EASY_RETURN_LIMITS.maxPolicyLength} characters`);

  const rawConditions = value.conditions == null ? [] : value.conditions;
  if (!Array.isArray(rawConditions)) throw httpError(400, 'Return conditions must be a list');
  const conditions = rawConditions.map((c) => String(c ?? '').trim()).filter(Boolean);
  if (conditions.length > EASY_RETURN_LIMITS.maxConditions) throw httpError(400, `Add at most ${EASY_RETURN_LIMITS.maxConditions} return conditions`);
  if (conditions.some((c) => c.length > EASY_RETURN_LIMITS.maxConditionLength)) throw httpError(400, `Each return condition can be at most ${EASY_RETURN_LIMITS.maxConditionLength} characters`);

  return { enabled: true, extraCharge: money(extraCharge), windowDays, policyText, conditions };
}

/**
 * The option a line actually gets. An unknown or missing value on an Easy Returns product
 * falls back to NO_EASY_RETURN (the regular price), so nobody is charged for an option they
 * did not pick. Products without Easy Returns carry no option at all.
 */
export function resolveReturnOption(product, requested) {
  if (!easyReturnsEnabled(product)) return undefined;
  if (requested != null && requested !== '' && !RETURN_OPTIONS.includes(requested)) throw httpError(400, 'Choose a valid return option');
  return requested === RETURN_OPTION.EASY_RETURN ? RETURN_OPTION.EASY_RETURN : RETURN_OPTION.NO_EASY_RETURN;
}

/** Strict version for request bodies: rejects anything that is not a known option. */
export function assertReturnOption(product, requested) {
  if (requested == null || requested === '') return resolveReturnOption(product, undefined);
  if (!RETURN_OPTIONS.includes(requested)) throw httpError(400, 'Choose a valid return option');
  if (!easyReturnsEnabled(product)) return undefined;
  return requested;
}

/** Extra charge per unit for this option (0 for NO_EASY_RETURN or products without the feature). */
export const returnExtraChargeFor = (product, option) =>
  (easyReturnsEnabled(product) && option === RETURN_OPTION.EASY_RETURN ? money(product.easyReturns.extraCharge || 0) : 0);

/** Unit price after the return option. `basePrice` already includes any live campaign discount. */
export const priceWithReturnOption = (basePrice, product, option) => money(Number(basePrice) + returnExtraChargeFor(product, option));

/**
 * Order-item fields frozen at checkout. `returnPolicy` replaces the category snapshot for
 * Easy Returns products so the existing delivery stamp (returnEligibleUntil) and return
 * checks use the seller's window.
 */
export function easyReturnOrderFields(product, option, unitPrice, categoryPolicy = {}) {
  if (!easyReturnsEnabled(product) || !option) return {};
  const cfg = product.easyReturns;
  return {
    returnOption: option,
    returnPolicySnapshot: { policyText: cfg.policyText, conditions: cfg.conditions || [], allowedReasons: option === RETURN_OPTION.EASY_RETURN ? null : RESTRICTED_RETURN_REASONS },
    returnEligibilityDays: cfg.windowDays,
    returnExtraCharge: returnExtraChargeFor(product, option),
    finalItemPrice: money(unitPrice),
    returnPolicy: {
      headerCategoryId: categoryPolicy.headerCategoryId ?? null,
      headerCategoryName: categoryPolicy.headerCategoryName ?? null,
      returnEligible: true,
      returnWindowDays: cfg.windowDays,
      sellerReturnable: true,
    },
  };
}

/** Reasons the customer may choose for this order item, from its frozen snapshot. */
export const allowedReturnReasonsFor = (item) =>
  (item?.returnOption === RETURN_OPTION.NO_EASY_RETURN ? RESTRICTED_RETURN_REASONS : null);

/** Server-side guard for a return request; never trusts the client's reason list. */
export function assertReturnReasonAllowed(item, reason) {
  const allowed = allowedReturnReasonsFor(item);
  if (allowed && !allowed.includes(reason)) {
    throw httpError(400, 'This item was bought without Easy Returns. It can only be returned if it is wrong, damaged or defective.', { code: 'RETURN_REASON_NOT_ALLOWED' });
  }
}
