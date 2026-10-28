import Order from '../models/Order.js';
import { sellerHistoryPaymentStages, eligiblePaymentStages } from './orderPaymentEligibility.service.js';
import { sellerOrderAmounts } from './sellerOrderAmounts.service.js';

export const SELLER_PENDING_STATUSES = ['placed', 'confirmed', 'preparing'];
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKey = date => dayFormatter.format(new Date(date));
const empty = () => ({ revenue: 0, revenuePendingOrders: 0, orders: 0, deliveredOrders: 0, netEarnings: 0, netEarningsPendingOrders: 0, netEarningsCalculatedOrders: 0, unpostedOrders: 0 });

// Read historical order terms, including allocated discounts. Checkout attempts
// and other sellers' goods must never contribute to the seller's sales figures.
export async function sellerDashboardMetrics(sellerId, channel, now = new Date()) {
  const byChannel = { ecommerce: empty(), grocery: empty() }, days = new Map();
  for (let offset = 29; offset >= 0; offset--) {
    days.set(dayKey(new Date(now.getTime() - offset * 86400000)), { ecommerce: 0, grocery: 0 });
  }
  const cursor = Order.aggregate([
    { $match: { 'items.sellerId': sellerId, type: { $in: ['ecommerce', 'grocery'] }, status: { $nin: ['cancelled', 'returned', 'refunded'] } } },
    ...sellerHistoryPaymentStages(),
    { $project: { type: 1, status: 1, items: 1, pricing: 1, financialSnapshot: 1, financialPosting: 1, financialReturnQuantities: 1, timeline: 1, updatedAt: 1, createdAt: 1 } },
  ]).cursor({ batchSize: 250 });
  for await (const order of cursor) {
    const totals = byChannel[order.type];
    totals.orders++;
    if (order.status !== 'delivered') continue;
    const amounts = sellerOrderAmounts(order, sellerId);
    totals.deliveredOrders++;
    if (!['held', 'eligible', 'reversed'].includes(order.financialPosting)) totals.unpostedOrders++;
    const hasReturns = Object.keys(order.financialReturnQuantities || {}).length > 0;
    if (Number.isFinite(amounts.customerItemsTotal) && !hasReturns) {
      const amount = Math.round(amounts.customerItemsTotal * 100);
      totals.revenue += amount;
      const deliveredAt = order.items.find(item => String(item.sellerId) === String(sellerId) && item.deliveredAt)?.deliveredAt
        || order.timeline?.find(event => event.status === 'delivered')?.timestamp || order.createdAt;
      const day = days.get(dayKey(deliveredAt));
      if (day) day[order.type] += amount;
    } else totals.revenuePendingOrders++;
    if (Number.isFinite(amounts.netEarnings) && !hasReturns) {
      totals.netEarnings += Math.round(amounts.netEarnings * 100);
      totals.netEarningsCalculatedOrders++;
    }
    else totals.netEarningsPendingOrders++;
  }
  const total = empty();
  for (const row of Object.values(byChannel)) for (const key of Object.keys(total)) total[key] += row[key];
  const scoped = channel ? byChannel[channel] : total;
  const [pending] = await Order.aggregate([
    { $match: { 'items.sellerId': sellerId, status: { $in: SELLER_PENDING_STATUSES }, ...(channel ? { type: channel } : {}) } },
    ...eligiblePaymentStages(), { $count: 'count' },
  ]);
  return {
    kpis: { totalOrders: scoped.orders, totalRevenue: scoped.revenuePendingOrders ? null : scoped.revenue / 100,
      knownRevenue: scoped.revenue / 100, revenuePendingOrders: scoped.revenuePendingOrders,
      avgOrderValue: scoped.revenuePendingOrders ? null : scoped.deliveredOrders ? Math.round(scoped.revenue / scoped.deliveredOrders) / 100 : 0,
      netEarnings: scoped.netEarningsPendingOrders ? null : scoped.netEarnings / 100,
      knownNetEarnings: scoped.netEarnings / 100, netEarningsPendingOrders: scoped.netEarningsPendingOrders,
      netEarningsCalculatedOrders: scoped.netEarningsCalculatedOrders, completedOrders: scoped.deliveredOrders, unpostedOrders: scoped.unpostedOrders,
      pendingOrders: pending?.count || 0 },
    byChannel: Object.fromEntries(Object.entries(byChannel).map(([key, value]) => [key, { ...value, revenue: value.revenuePendingOrders ? null : value.revenue / 100, netEarnings: value.netEarningsPendingOrders ? null : value.netEarnings / 100 }])),
    salesPerformance: [...days].map(([date, amounts]) => ({ date, revenue: (channel ? amounts[channel] : amounts.ecommerce + amounts.grocery) / 100 })),
  };
}
