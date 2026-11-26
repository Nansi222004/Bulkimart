import mongoose from 'mongoose';
import Warehouse from '../models/Warehouse.js';
import WarehouseStock from '../models/WarehouseStock.js';
import { DELIVERY_METHOD } from '../constants/enums.js';
import { httpError } from '../utils/response.js';
import { checkServiceability } from './shiprocket.service.js';
import { shiprocketCodEnabled } from './courierTracking.service.js';

/**
 * Can an FBB parcel actually leave the warehouse for this address? Asked at checkout, before any write.
 *
 * The carrier is still chosen after acceptance (Shiprocket or a Bulkimart rider), so this does not pick one.
 * It only refuses an order that Bulkimart already knows it cannot deliver: Shiprocket, asked about the route
 * warehouse pincode → customer pincode (with COD when the order is COD), answers that no courier serves it.
 *
 * What it never does:
 *   - assume nationwide coverage: "not serviceable" from Shiprocket refuses the order;
 *   - invent a rider area: there is no declared rider coverage for a warehouse, so a rider route is never
 *     claimed or ruled out here (riders are matched on duty and location after packing, as today);
 *   - ask Shiprocket about a route it could not take anyway (no registered warehouse pickup, or COD while
 *     Shiprocket COD is off). Those orders can only go by rider, so the answer is "unknown", not "no".
 *
 * "unknown" and provider errors let the order through, as checkout did before this check existed, unless
 * FBB_SERVICEABILITY_STRICT=true (a business decision: refuse sales Bulkimart cannot verify). Easy Ship and
 * Self Delivery are not checked here; Self Delivery has its own declared area (selfDeliveryArea.service.js).
 */

const flag = (name) => String(process.env[name] || '').trim().toLowerCase() === 'true';
export const fbbServiceabilityStrict = () => flag('FBB_SERVICEABILITY_STRICT');

export const FBB_NOT_SERVICEABLE = 'FBB_NOT_SERVICEABLE';
export const FBB_SERVICEABILITY_UNVERIFIED = 'FBB_SERVICEABILITY_UNVERIFIED';
const NOT_SERVICEABLE_MESSAGE = (pin) => `Fulfilled by Bulkimart items cannot be delivered to ${pin || 'this address'} yet. Remove those items or choose another address.`;
const UNVERIFIED_MESSAGE = 'We could not confirm delivery of Fulfilled by Bulkimart items to this address right now. Please try again shortly.';

/** Package weight in kg from frozen line weights (grams); null when any line has none. */
const weightKgOf = (lines) => {
  let grams = 0;
  for (const line of lines) {
    const weight = Number(line.weightSnapshot);
    if (!Number.isFinite(weight) || weight <= 0) return null;
    grams += weight * Number(line.qty || 0);
  }
  return Number((grams / 1000).toFixed(3));
};

/**
 * Shiprocket's verdict for one warehouse → address route.
 * @returns {Promise<{ status: 'serviceable'|'not_serviceable'|'unknown'|'error', reason?: string }>}
 */
export const warehouseRouteVerdict = async ({ warehouse, address, cod, weightKg }) => {
  const pin = String(address?.pincode ?? '').trim();
  if (!/^[1-9]\d{5}$/.test(pin)) return { status: 'unknown', reason: 'no_delivery_pincode' };
  if (!warehouse?.shiprocketPickupLocation) return { status: 'unknown', reason: 'no_courier_pickup' };
  if (cod && !shiprocketCodEnabled()) return { status: 'unknown', reason: 'courier_cod_unavailable' };
  try {
    const result = await checkServiceability({ pickupPostcode: warehouse.address?.pincode, deliveryPostcode: pin, weight: weightKg || undefined, cod: Boolean(cod) });
    if (!result || typeof result.available !== 'boolean') return { status: 'error', reason: 'incomplete_answer' };
    return result.available && result.couriers?.length ? { status: 'serviceable' } : { status: 'not_serviceable' };
  } catch {
    return { status: 'error', reason: 'provider_unavailable' };
  }
};

/**
 * Verdicts for every active warehouse that could fill these FBB lines (it holds enough sellable units of at
 * least one of them; the reservation decides the final warehouse). Run before the checkout transaction.
 *
 * @param {object} input
 * @param {Array<Array<object>>} input.shipments  FBB lines grouped by the order they will become
 * @param {object} input.address                  the delivery address being checked out
 * @param {string} input.paymentMethod
 * @returns {Promise<null|{ verdicts: Map<string, object>, pincode: string }>} null when there is nothing to check
 */
export const assessFbbCheckout = async ({ shipments, address, paymentMethod }) => {
  const groups = (shipments || []).map((lines) => (lines || []).filter((line) => line.deliveryMethod === DELIVERY_METHOD.FBB)).filter((lines) => lines.length);
  if (!groups.length) return null;
  const lines = groups.flat();
  const stockFilter = lines.filter((line) => mongoose.isValidObjectId(line.productId) && mongoose.isValidObjectId(line.variantId))
    .map((line) => ({ productId: line.productId, variantId: line.variantId, sellable: { $gte: Number(line.qty) || 1 } }));
  const warehouseIds = stockFilter.length ? await WarehouseStock.distinct('warehouseId', { $or: stockFilter }) : [];
  const warehouses = warehouseIds.length ? await Warehouse.find({ _id: { $in: warehouseIds }, isActive: true }).lean() : [];
  // Each order ships separately; the heaviest decides (a heavier parcel never has more couriers).
  const weights = groups.map(weightKgOf);
  const weightKg = weights.some((w) => w === null) ? null : Math.max(...weights);
  const cod = paymentMethod === 'cod';
  const verdicts = new Map();
  for (const warehouse of warehouses) verdicts.set(String(warehouse._id), await warehouseRouteVerdict({ warehouse, address, cod, weightKg }));
  return { verdicts, pincode: String(address?.pincode ?? '').trim() };
};

const refusal = (verdict, pincode) => {
  if (verdict.status === 'not_serviceable') return httpError(409, NOT_SERVICEABLE_MESSAGE(pincode), { code: FBB_NOT_SERVICEABLE });
  if (fbbServiceabilityStrict() && verdict.status !== 'serviceable') return httpError(409, UNVERIFIED_MESSAGE, { code: FBB_SERVICEABILITY_UNVERIFIED });
  return null;
};

/** Before the transaction: refuse when no candidate warehouse can serve the address. */
export const assertFbbCheckoutServiceable = (assessment) => {
  if (!assessment || !assessment.verdicts.size) return; // no stock anywhere: the reservation reports it
  const refusals = [...assessment.verdicts.values()].map((verdict) => refusal(verdict, assessment.pincode));
  if (refusals.every(Boolean)) throw refusals.find((error) => error.meta?.code === FBB_NOT_SERVICEABLE) || refusals[0];
};

/** Warehouses this checkout must not reserve from (so the reservation picks one that can deliver). */
export const blockedWarehouseIds = (assessment) => (assessment
  ? [...assessment.verdicts.entries()].filter(([, verdict]) => refusal(verdict, assessment.pincode)).map(([warehouseId]) => new mongoose.Types.ObjectId(warehouseId))
  : []);

/**
 * Inside the transaction, once the reservation chose the warehouse: refuse when that warehouse cannot serve
 * the address. A warehouse that was not assessed (stock moved meanwhile) counts as unknown.
 */
export const assertFbbWarehouseServiceable = (assessment, warehouseId) => {
  if (!assessment) return;
  const error = refusal(assessment.verdicts.get(String(warehouseId)) || { status: 'unknown' }, assessment.pincode);
  if (error) throw error;
};
