import mongoose from 'mongoose';
import Cart from '../models/Cart.js';
import CartActivity from '../models/CartActivity.js';
import CartReminder from '../models/CartReminder.js';
import CartReminderSetting, { CART_REMINDER_DEFAULTS } from '../models/CartReminderSetting.js';
import User from '../models/User.js';
import Order from '../models/Order.js';
import { notifyUser, NOTIFICATION_EVENT } from './notification.service.js';
import { httpError } from '../utils/response.js';

/**
 * Abandoned carts: what customers left in their cart, their add/remove history, and
 * "your cart is waiting" reminders (sent by an admin, or automatically when enabled).
 * A reminder counts as recovered when the customer orders within RECOVERY_DAYS of it.
 */
export const RECOVERY_DAYS = 7;
const MAX_REMINDERS_PER_SEND = 500;
const oid = (v) => (mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : null);

// ---------------------------------------------------------------- activity log
/**
 * Records cart changes. Never throws and never delays the cart response:
 * the history is for admins, the cart is for the customer.
 */
export function logCartActivity(userId, channel, entries) {
  const rows = (Array.isArray(entries) ? entries : [entries]).filter(Boolean).map((e) => ({
    userId, channel, action: e.action,
    productId: e.productId, variantId: e.variantId || undefined,
    name: e.name, image: e.image, price: e.price, qty: e.qty, fromQty: e.fromQty, at: new Date(),
  }));
  if (!rows.length) return;
  CartActivity.insertMany(rows, { ordered: false }).catch((err) => console.warn('[CART HISTORY] not recorded:', err.message));
}

// ---------------------------------------------------------------- settings
export async function getCartReminderSetting() {
  const row = await CartReminderSetting.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
  return { ...CART_REMINDER_DEFAULTS, ...(row ? {
    autoEnabled: row.autoEnabled === true, autoAfterHours: row.autoAfterHours, minGapHours: row.minGapHours, title: row.title, message: row.message,
  } : {}) };
}

export function validateCartReminderSetting(input = {}) {
  const hours = (key, label) => {
    const n = Number(input[key]);
    if (!Number.isFinite(n) || n < 1 || n > 720) throw httpError(400, `${label} must be between 1 and 720 hours`);
    return Math.round(n * 10) / 10;
  };
  const text = (key, label, max) => {
    const v = String(input[key] ?? '').trim();
    if (!v || v.length > max) throw httpError(400, `${label} is required (maximum ${max} characters)`);
    return v;
  };
  return {
    autoEnabled: input.autoEnabled === true,
    autoAfterHours: hours('autoAfterHours', 'Automatic reminder delay'),
    minGapHours: hours('minGapHours', 'Gap between reminders'),
    title: text('title', 'Notification title', 80),
    message: text('message', 'Notification message', 300),
  };
}

// ---------------------------------------------------------------- messages
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';
/** Fills {name}, {item}, {more} and {count} for one customer. */
export function personalizeReminder(template, user, items = []) {
  const count = items.reduce((n, i) => n + (Number(i.qty) || 0), 0);
  const item = items[0]?.name ? String(items[0].name).slice(0, 60) : 'your items';
  const others = items.length - 1;
  const more = others > 0 ? ` and ${others} more item${others === 1 ? '' : 's'}` : '';
  return String(template)
    .replaceAll('{name}', firstName(user?.name))
    .replaceAll('{item}', item)
    .replaceAll('{more}', more)
    .replaceAll('{count}', String(count));
}

// ---------------------------------------------------------------- abandoned carts list
/**
 * One row per customer with items left in a cart untouched for `inactiveHours`.
 * Values use the price shown when each item was added (display only).
 */
function abandonedPipeline({ inactiveHours = 1, channel, minValue, reminded, q } = {}) {
  const cutoff = new Date(Date.now() - Math.max(0, Number(inactiveHours) || 0) * 3600 * 1000);
  const stages = [
    { $match: { 'items.0': { $exists: true }, updatedAt: { $lte: cutoff }, ...(channel ? { channel: String(channel) } : {}) } },
    { $project: {
      userId: 1, channel: 1, updatedAt: 1,
      lines: { $size: '$items' },
      itemCount: { $sum: '$items.qty' },
      value: { $sum: { $map: { input: '$items', in: { $multiply: [{ $ifNull: ['$$this.price', 0] }, { $ifNull: ['$$this.qty', 0] }] } } } },
      names: { $slice: ['$items.name', 3] },
    } },
    { $group: {
      _id: '$userId',
      carts: { $push: { channel: '$channel', lines: '$lines', itemCount: '$itemCount', value: '$value', updatedAt: '$updatedAt' } },
      lines: { $sum: '$lines' }, itemCount: { $sum: '$itemCount' }, value: { $sum: '$value' },
      lastActivity: { $max: '$updatedAt' }, names: { $push: '$names' },
    } },
  ];
  if (Number(minValue) > 0) stages.push({ $match: { value: { $gte: Number(minValue) } } });
  stages.push(
    { $lookup: { from: User.collection.name, localField: '_id', foreignField: '_id', as: 'user', pipeline: [{ $project: { name: 1, phone: 1, email: 1, isActive: 1 } }] } },
    { $unwind: '$user' },
    { $match: { 'user.isActive': { $ne: false } } },
  );
  const text = String(q || '').trim().slice(0, 60);
  if (text) {
    const rx = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    stages.push({ $match: { $or: [{ 'user.name': rx }, { 'user.phone': rx }, { 'user.email': rx }] } });
  }
  stages.push(
    { $lookup: { from: CartReminder.collection.name, localField: '_id', foreignField: 'userId', as: 'reminders', pipeline: [{ $sort: { sentAt: -1 } }, { $project: { sentAt: 1, source: 1 } }] } },
    { $addFields: { reminderCount: { $size: '$reminders' }, lastReminderAt: { $first: '$reminders.sentAt' } } },
    { $project: { reminders: 0 } },
  );
  if (reminded === 'yes') stages.push({ $match: { lastReminderAt: { $ne: null } } });
  if (reminded === 'no') stages.push({ $match: { lastReminderAt: null } });
  return stages;
}

const shapeRow = (r) => ({
  userId: r._id, name: r.user.name || 'Customer', phone: r.user.phone, email: r.user.email,
  carts: r.carts, lines: r.lines, itemCount: r.itemCount, value: Math.round(r.value * 100) / 100,
  preview: r.names.flat().filter(Boolean).slice(0, 3), lastActivity: r.lastActivity,
  reminderCount: r.reminderCount, lastReminderAt: r.lastReminderAt || null,
});

export async function listAbandonedCarts(filters = {}) {
  const page = Math.max(1, Number(filters.page) || 1), limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));
  const [result] = await Cart.aggregate([
    ...abandonedPipeline(filters),
    { $facet: {
      rows: [{ $sort: { lastActivity: -1 } }, { $skip: (page - 1) * limit }, { $limit: limit }],
      totals: [{ $group: { _id: null, customers: { $sum: 1 }, value: { $sum: '$value' }, items: { $sum: '$itemCount' } } }],
    } },
  ]);
  const totals = result?.totals?.[0] || { customers: 0, value: 0, items: 0 };
  return {
    rows: (result?.rows || []).map(shapeRow),
    totals: { customers: totals.customers, value: Math.round(totals.value * 100) / 100, items: totals.items },
    page, limit, totalPages: Math.max(1, Math.ceil(totals.customers / limit)),
  };
}

/** Customer ids matching the filters (for "remind everyone in this list"). */
export async function abandonedCartUserIds(filters = {}) {
  const rows = await Cart.aggregate([...abandonedPipeline(filters), { $sort: { lastActivity: -1 } }, { $limit: MAX_REMINDERS_PER_SEND }, { $project: { _id: 1 } }]);
  return rows.map((r) => r._id);
}

/** The first order a customer placed within RECOVERY_DAYS after `sentAt`, if any. */
async function recoveredOrder(userId, sentAt) {
  const end = new Date(new Date(sentAt).getTime() + RECOVERY_DAYS * 24 * 3600 * 1000);
  return Order.findOne({ userId, createdAt: { $gte: sentAt, $lte: end } }).sort({ createdAt: 1 })
    .select('orderNo createdAt status pricing.totalAmount').lean();
}

export async function abandonedCartDetail(userId) {
  const id = oid(userId);
  if (!id) throw httpError(400, 'Invalid customer');
  const user = await User.findById(id).select('name phone email isActive createdAt').lean();
  if (!user) throw httpError(404, 'Customer not found');
  const [carts, activity, reminders, orders] = await Promise.all([
    Cart.find({ userId: id }).select('channel items updatedAt').lean(),
    CartActivity.find({ userId: id }).sort({ at: -1 }).limit(200).lean(),
    CartReminder.find({ userId: id }).sort({ sentAt: -1 }).limit(50).populate('sentBy', 'name').lean(),
    Order.find({ userId: id }).sort({ createdAt: -1 }).limit(10).select('orderNo createdAt status type pricing.totalAmount').lean(),
  ]);
  const withRecovery = await Promise.all(reminders.map(async (r) => {
    const o = await recoveredOrder(id, r.sentAt);
    return { ...r, sentBy: r.sentBy?.name, recovered: o ? { orderId: o._id, orderNo: o.orderNo, at: o.createdAt, amount: o.pricing?.totalAmount } : null };
  }));
  return {
    customer: { _id: user._id, name: user.name || 'Customer', phone: user.phone, email: user.email, isActive: user.isActive !== false, joinedAt: user.createdAt },
    carts: carts.filter((c) => c.items?.length).map((c) => ({
      channel: c.channel, updatedAt: c.updatedAt,
      items: c.items.map((i) => ({ _id: i._id, productId: i.productId, name: i.name, image: i.image, price: i.price, qty: i.qty, variantName: i.variantName, addedAt: i.addedAt })),
      value: Math.round(c.items.reduce((n, i) => n + (i.price || 0) * (i.qty || 0), 0) * 100) / 100,
    })),
    activity,
    reminders: withRecovery,
    orders: orders.map((o) => ({ _id: o._id, orderNo: o.orderNo, createdAt: o.createdAt, status: o.status, type: o.type, amount: o.pricing?.totalAmount })),
  };
}

/** Headline numbers: carts waiting now, and how reminders did in the last `days`. */
export async function cartRecoveryStats({ inactiveHours = 1, days = 30 } = {}) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const [waiting] = await Cart.aggregate([...abandonedPipeline({ inactiveHours }), { $group: { _id: null, customers: { $sum: 1 }, value: { $sum: '$value' } } }]);
  const [sent] = await CartReminder.aggregate([
    { $match: { sentAt: { $gte: since } } },
    { $lookup: { from: Order.collection.name, let: { u: '$userId', s: '$sentAt' }, as: 'order', pipeline: [
      { $match: { $expr: { $and: [{ $eq: ['$userId', '$$u'] }, { $gte: ['$createdAt', '$$s'] }, { $lte: ['$createdAt', { $add: ['$$s', RECOVERY_DAYS * 24 * 3600 * 1000] }] }] } } },
      { $sort: { createdAt: 1 } }, { $limit: 1 }, { $project: { amount: '$pricing.totalAmount' } },
    ] } },
    { $group: { _id: null, reminders: { $sum: 1 }, recovered: { $sum: { $cond: [{ $gt: [{ $size: '$order' }, 0] }, 1, 0] } }, recoveredValue: { $sum: { $ifNull: [{ $first: '$order.amount' }, 0] } } } },
  ]);
  return {
    waiting: { customers: waiting?.customers || 0, value: Math.round((waiting?.value || 0) * 100) / 100 },
    lastDays: days,
    reminders: sent?.reminders || 0,
    recovered: sent?.recovered || 0,
    recoveredValue: Math.round((sent?.recoveredValue || 0) * 100) / 100,
    recoveryRate: sent?.reminders ? Math.round((sent.recovered / sent.reminders) * 1000) / 10 : 0,
  };
}

// ---------------------------------------------------------------- sending
/**
 * Sends the reminder to each customer who still has items in a cart and was not
 * reminded within the admin's gap. Returns how many went out and why others did not.
 */
export async function sendCartReminders({ userIds, title, message, source = 'admin', adminId } = {}) {
  const settings = await getCartReminderSetting();
  const ids = [...new Set((userIds || []).map(String))].map(oid).filter(Boolean).slice(0, MAX_REMINDERS_PER_SEND);
  if (!ids.length) throw httpError(400, 'Choose at least one customer');
  const titleTpl = String(title || settings.title).trim().slice(0, 80);
  const messageTpl = String(message || settings.message).trim().slice(0, 300);
  if (!titleTpl || !messageTpl) throw httpError(400, 'Notification title and message are required');
  const gapStart = new Date(Date.now() - settings.minGapHours * 3600 * 1000);

  const [users, carts, recent] = await Promise.all([
    User.find({ _id: { $in: ids } }).select('name isActive').lean(),
    Cart.find({ userId: { $in: ids }, 'items.0': { $exists: true } }).select('userId items updatedAt').lean(),
    CartReminder.find({ userId: { $in: ids }, sentAt: { $gte: gapStart } }).select('userId').lean(),
  ]);
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const recentSet = new Set(recent.map((r) => String(r.userId)));
  const result = { sent: 0, skipped: [] };
  for (const id of ids) {
    const key = String(id), user = userById.get(key);
    if (!user || user.isActive === false) { result.skipped.push({ userId: key, reason: 'inactive_account' }); continue; }
    const own = carts.filter((c) => String(c.userId) === key);
    const items = own.flatMap((c) => c.items).sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));
    if (!items.length) { result.skipped.push({ userId: key, reason: 'empty_cart' }); continue; }
    if (recentSet.has(key)) { result.skipped.push({ userId: key, reason: 'recently_reminded' }); continue; }
    const finalTitle = personalizeReminder(titleTpl, user, items).slice(0, 120);
    const finalMessage = personalizeReminder(messageTpl, user, items).slice(0, 400);
    const sentAt = new Date();
    await notifyUser(key, {
      event: NOTIFICATION_EVENT.CART_REMINDER, title: finalTitle, message: finalMessage, route: '/cart',
      dedupeKey: `CART_REMINDER:${key}:${sentAt.getTime()}`, metadata: {},
    }).catch(() => null);
    await CartReminder.create({
      userId: id, title: finalTitle, message: finalMessage, source, sentBy: source === 'admin' ? adminId : undefined,
      itemCount: items.reduce((n, i) => n + (i.qty || 0), 0),
      cartValue: Math.round(items.reduce((n, i) => n + (i.price || 0) * (i.qty || 0), 0) * 100) / 100,
      cartUpdatedAt: new Date(Math.max(...own.map((c) => new Date(c.updatedAt).getTime()))), sentAt,
    });
    recentSet.add(key);
    result.sent += 1;
  }
  return result;
}

// ---------------------------------------------------------------- automatic reminders
const AUTO_EVERY_MS = 10 * 60 * 1000;
let lastAutoRun = 0, autoRunning = false;
/**
 * When enabled, reminds customers whose cart has been untouched for `autoAfterHours`.
 * Once per abandonment: a customer is reminded again only after changing the cart
 * and leaving it again (and never within the admin's gap). Runs from the order sweeper.
 */
export async function sweepAutoCartReminders({ force = false } = {}) {
  if (autoRunning || (!force && Date.now() - lastAutoRun < AUTO_EVERY_MS)) return { sent: 0 };
  autoRunning = true; lastAutoRun = Date.now();
  try {
    const settings = await getCartReminderSetting();
    if (!settings.autoEnabled) return { sent: 0 };
    const rows = await Cart.aggregate([
      ...abandonedPipeline({ inactiveHours: settings.autoAfterHours }),
      // Not yet reminded since the cart last changed.
      { $match: { $or: [{ lastReminderAt: null }, { $expr: { $lt: ['$lastReminderAt', '$lastActivity'] } }] } },
      { $sort: { lastActivity: 1 } }, { $limit: 200 }, { $project: { _id: 1 } },
    ]);
    if (!rows.length) return { sent: 0 };
    return await sendCartReminders({ userIds: rows.map((r) => r._id), source: 'auto' });
  } finally { autoRunning = false; }
}
