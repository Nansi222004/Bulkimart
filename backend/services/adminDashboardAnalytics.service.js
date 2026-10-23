import Order from '../models/Order.js';
import { ORDER_STATUSES, ORDER_TYPES } from '../constants/enums.js';

const salesChannels = ['retail', 'wholesale'];
const group = (field, keys) => [
  { $group: { _id: { $cond: [{ $in: [`$${field}`, keys] }, `$${field}`, 'unknown'] }, count: { $sum: 1 } } },
];

function distribution(rows, keys, total) {
  const allowed = [...keys, 'unknown'];
  const seen = new Set();
  if (!Array.isArray(rows)) throw Error('Invalid order analytics');
  const result = rows.map(row => {
    if (!allowed.includes(row._id) || seen.has(row._id) || !Number.isSafeInteger(row.count) || row.count <= 0) throw Error('Invalid order analytics');
    seen.add(row._id);
    return { key: row._id, count: row.count };
  }).sort((a, b) => allowed.indexOf(a.key) - allowed.indexOf(b.key));
  if (result.reduce((sum, row) => sum + row.count, 0) !== total) throw Error('Inconsistent order analytics');
  return result;
}

// Operational counts only. No Payment join or financial attribution.
export async function getAdminOrderAnalytics() {
  const [result] = await Order.aggregate([
    { $project: { _id: 0, status: 1, type: 1, salesChannel: 1 } },
    { $facet: {
      total: [{ $count: 'count' }],
      statuses: group('status', ORDER_STATUSES),
      channels: group('type', ORDER_TYPES),
      salesChannels: group('salesChannel', salesChannels),
    } },
  ]).option({ maxTimeMS: 10000 });
  if (!result || !Array.isArray(result.total) || result.total.length > 1) throw Error('Invalid order analytics');
  const totalOrders = result.total.length ? result.total[0].count : 0;
  if (!Number.isSafeInteger(totalOrders) || totalOrders < 0) throw Error('Invalid order count');
  return {
    version: 1, scope: 'all-time', timezone: 'Asia/Kolkata', unit: 'orders', measure: 'fulfilment-orders',
    asOf: new Date().toISOString(), totalOrders,
    statuses: distribution(result.statuses, ORDER_STATUSES, totalOrders),
    channels: distribution(result.channels, ORDER_TYPES, totalOrders),
    salesChannels: distribution(result.salesChannels, salesChannels, totalOrders),
  };
}
