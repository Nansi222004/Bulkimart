import { resolveReturnPolicyForCategory } from './returnPolicy.service.js';
import { httpError } from '../utils/response.js';

// A product may narrow the category policy; it cannot widen its allowed window.
export function applyProductReturnSettings(product, categoryPolicy) {
  const allowed = product?.fulfillmentType !== 'digital' && (product?.type === 'grocery' ? product.returnable === true : categoryPolicy.source === 'global' ? product?.returnSettings?.enabled === true : product?.returnSettings?.enabled !== false);
  const categoryDays = categoryPolicy.returnWindowDays;
  const requested = product?.returnSettings?.windowDays;
  const days = Number.isSafeInteger(requested) && requested > 0 && Number.isFinite(categoryDays) ? Math.min(requested, categoryDays) : categoryDays;
  return { ...categoryPolicy, sellerReturnable: allowed, returnWindowDays: days,
    returnEligible: allowed && (categoryPolicy.returnEligible ?? categoryPolicy.eligible) === true && days > 0 };
}

export async function parseProductReturnSettings(body, product) {
  if (body.returnable === undefined && body.returnWindowDays === undefined) return undefined;
  if (!['grocery','ecommerce'].includes(product.type) || product.fulfillmentType === 'digital') throw httpError(400, 'Return settings are available only for physical retail products');
  if (body.returnable !== undefined && ![true,false,'true','false'].includes(body.returnable)) throw httpError(400, 'Choose whether this product accepts returns');
  const enabled = body.returnable === undefined ? (product.type === 'grocery' ? Boolean(product.returnable) : product.returnSettings?.enabled !== false) : [true,'true'].includes(body.returnable);
  const rawDays = body.returnWindowDays === undefined ? product.returnSettings?.windowDays : body.returnWindowDays;
  if (!enabled) return { enabled: false };
  if (rawDays === '' || rawDays == null) return { enabled: true };
  if (!['string','number'].includes(typeof rawDays)) throw httpError(400, 'Return window must be a positive whole number of days');
  const days = Number(rawDays);
  if (!Number.isSafeInteger(days) || days <= 0) throw httpError(400, 'Return window must be a positive whole number of days');
  const category = await resolveReturnPolicyForCategory(product.category?._id || product.category);
  if (!category.eligible) throw httpError(400, 'Admin must enable a category or global return window before a product window can be set');
  if (days > category.returnWindowDays) throw httpError(400, `Return window cannot exceed the ${category.source === 'global' ? 'global' : 'category'} limit of ${category.returnWindowDays} days`);
  return { enabled: true, windowDays: days };
}
