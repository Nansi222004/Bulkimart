import mongoose from 'mongoose';
import Admin from '../models/Admin.js';
import User from '../models/User.js';
import Seller from '../models/Seller.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Return from '../models/Return.js';
import Delivery from '../models/Delivery.js';
import SellerPayout from '../models/SellerPayout.js';
import DeliveryPayout from '../models/DeliveryPayout.js';
import WalletLedger from '../models/WalletLedger.js';
import CoinWallet from '../models/CoinWallet.js';
import CoinTransaction from '../models/CoinTransaction.js';
import Product from '../models/Product.js';
import SellerPromotion from '../models/SellerPromotion.js';
import CampaignParticipation from '../models/CampaignParticipation.js';
import PackagingOrder from '../models/PackagingOrder.js';
import Cart from '../models/Cart.js';
import CheckoutAttempt from '../models/CheckoutAttempt.js';
import CouponRedemption from '../models/CouponRedemption.js';
import Ticket from '../models/Ticket.js';
import Notification from '../models/Notification.js';
import AccountActionAudit from '../models/AccountActionAudit.js';

const TERMINAL_ORDER_STATUSES = ['delivered', 'cancelled', 'returned', 'refunded'];
const TERMINAL_RETURN_STATUSES = ['REJECTED', 'CANCELLED', 'REFUNDED'];
const TERMINAL_DELIVERY_STATUSES = ['delivered', 'rejected', 'failed'];

const count = (Model, filter) => Model.countDocuments(filter);
const positive = (value) => Math.abs(Number(value || 0)) > 0.000001;
const reason = (code, countValue = 1) => ({ code, count: Number(countValue || 0) });

const baseAssessment = (category, targetId, dependencies, blocks, history) => {
  const blocked = blocks.filter((r) => r.count > 0);
  const historical = history.filter((r) => r.count > 0);
  return {
    category,
    targetId,
    action: blocked.length ? 'skip' : historical.length ? 'deactivate' : 'delete',
    reasonCodes: [...blocked, ...historical].map((r) => r.code),
    dependencies,
  };
};

const protectedAdminIdentity = async (user) => {
  const email = String(user?.email || '').trim().toLowerCase();
  if (!email) return false;
  const configured = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (configured && email === configured) return true;
  return Boolean(await Admin.exists({ email }));
};

export const assessCustomerAccount = async (userOrId) => {
  const user = typeof userOrId === 'object' && userOrId?._id
    ? userOrId
    : await User.findById(userOrId).select('+email');
  if (!user) return null;

  const userId = user._id;
  const [sellerProfile, deliveryProfile, activeOrders, orders, unresolvedPayments, payments,
    unresolvedReturns, returns, walletLedger, coinWallet, coinTransactions, carts,
    checkoutAttempts, couponRedemptions, tickets, notifications, protectedIdentity] = await Promise.all([
    Seller.countDocuments({ userId }),
    DeliveryPartner.countDocuments({ userId }),
    count(Order, { userId, status: { $nin: TERMINAL_ORDER_STATUSES } }),
    count(Order, { userId }),
    count(Payment, { userId, $or: [{ status: 'pending' }, { 'refund.status': { $in: ['pending', 'failed'] } }] }),
    count(Payment, { userId }),
    count(Return, { customerId: userId, status: { $nin: TERMINAL_RETURN_STATUSES } }),
    count(Return, { customerId: userId }),
    count(WalletLedger, { userId }),
    CoinWallet.findOne({ userId }).select('availableCoins reservedCoins').lean(),
    count(CoinTransaction, { userId }),
    count(Cart, { userId }),
    count(CheckoutAttempt, { userId }),
    count(CouponRedemption, { userId }),
    count(Ticket, { userId }),
    count(Notification, { userId, recipientModel: 'User' }),
    protectedAdminIdentity(user),
  ]);

  const walletBalance = Number(user.wallet?.balance || 0);
  const coinBalance = Number(coinWallet?.availableCoins || 0);
  const reservedCoins = Number(coinWallet?.reservedCoins || 0);
  const dependencies = {
    sellerProfile, deliveryProfile, activeOrders, orders, unresolvedPayments, payments,
    unresolvedReturns, returns, walletLedger, coinTransactions, carts, checkoutAttempts,
    couponRedemptions, tickets, notifications,
    walletBalanceNonZero: positive(walletBalance) ? 1 : 0,
    coinWalletExists: coinWallet ? 1 : 0,
    coinBalanceNonZero: positive(coinBalance) ? 1 : 0,
    reservedCoinsNonZero: positive(reservedCoins) ? 1 : 0,
    protectedAdminIdentity: protectedIdentity ? 1 : 0,
  };

  const blocks = [
    reason('PROTECTED_ADMIN_IDENTITY', dependencies.protectedAdminIdentity),
    reason('ROLE_PROFILE_EXISTS', sellerProfile + deliveryProfile),
    reason('ACTIVE_ORDERS', activeOrders),
    reason('UNRESOLVED_PAYMENTS', unresolvedPayments),
    reason('UNRESOLVED_RETURNS', unresolvedReturns),
    reason('WALLET_BALANCE', dependencies.walletBalanceNonZero),
    reason('COIN_BALANCE', dependencies.coinBalanceNonZero),
    reason('RESERVED_COINS', dependencies.reservedCoinsNonZero),
  ];
  const history = [
    reason('ORDER_HISTORY', orders), reason('PAYMENT_HISTORY', payments),
    reason('RETURN_HISTORY', returns), reason('WALLET_LEDGER', walletLedger),
    reason('COIN_WALLET', dependencies.coinWalletExists), reason('COIN_LEDGER', coinTransactions),
    reason('ACCOUNT_REFERENCES', carts + checkoutAttempts + couponRedemptions + tickets + notifications),
  ];
  return baseAssessment('customer', userId, dependencies, blocks, history);
};

export const assessSellerAccount = async (sellerOrId) => {
  const seller = typeof sellerOrId === 'object' && sellerOrId?._id ? sellerOrId : await Seller.findById(sellerOrId);
  if (!seller) return null;
  const sellerId = seller._id;
  const [activeOrders, orders, unresolvedReturns, returns, pendingPayouts, payouts, products,
    activePromotions, promotions, campaigns, packagingOrders] = await Promise.all([
    count(Order, { items: { $elemMatch: { sellerId } }, status: { $nin: TERMINAL_ORDER_STATUSES } }),
    count(Order, { 'items.sellerId': sellerId }),
    count(Return, { sellerId, status: { $nin: TERMINAL_RETURN_STATUSES } }),
    count(Return, { sellerId }),
    count(SellerPayout, { sellerId, status: { $in: ['PENDING', 'APPROVED'] } }),
    count(SellerPayout, { sellerId }),
    count(Product, { sellerId }),
    0, // Retired advertisements no longer block seller account lifecycle actions.
    count(SellerPromotion, { sellerId }),
    count(CampaignParticipation, { sellerId }),
    count(PackagingOrder, { sellerId }),
  ]);
  const dependencies = { activeOrders, orders, unresolvedReturns, returns, pendingPayouts, payouts, products, activePromotions, promotions, campaigns, packagingOrders };
  const blocks = [reason('ACTIVE_ORDERS', activeOrders), reason('UNRESOLVED_RETURNS', unresolvedReturns), reason('PENDING_PAYOUTS', pendingPayouts)];
  const history = [reason('ORDER_HISTORY', orders), reason('RETURN_HISTORY', returns), reason('PAYOUT_HISTORY', payouts), reason('PRODUCT_CATALOG', products), reason('PROMOTION_HISTORY', promotions), reason('CAMPAIGN_HISTORY', campaigns), reason('PACKAGING_ORDER_HISTORY', packagingOrders)];
  return baseAssessment('seller', sellerId, dependencies, blocks, history);
};

export const assessDeliveryAccount = async (partnerOrId) => {
  const partner = typeof partnerOrId === 'object' && partnerOrId?._id ? partnerOrId : await DeliveryPartner.findById(partnerOrId);
  if (!partner) return null;
  const partnerId = partner._id;
  const [activeOrders, activeDeliveries, deliveries, activeReturns, returns, pendingPayouts, payouts] = await Promise.all([
    count(Order, { deliveryPartnerId: partnerId, status: { $nin: TERMINAL_ORDER_STATUSES } }),
    count(Delivery, { partnerId, status: { $nin: TERMINAL_DELIVERY_STATUSES } }),
    count(Delivery, { partnerId }),
    count(Return, { $or: [{ 'pickup.partnerId': partnerId }, { 'pickup.offerAttempts.riderId': partnerId }], 'pickup.status': { $nin: ['NOT_ASSIGNED', 'DELIVERED_TO_SELLER', 'CANCELLED'] } }),
    count(Return, { $or: [{ 'pickup.partnerId': partnerId }, { 'pickup.offerAttempts.riderId': partnerId }] }),
    count(DeliveryPayout, { partnerId, status: 'pending' }),
    count(DeliveryPayout, { partnerId }),
  ]);
  const pendingEarnings = Number(partner.earnings?.pending || 0);
  const dependencies = { activeOrders, activeDeliveries, deliveries, activeReturns, returns, pendingPayouts, payouts, pendingEarningsNonZero: positive(pendingEarnings) ? 1 : 0 };
  const blocks = [reason('ACTIVE_ORDERS', activeOrders), reason('ACTIVE_DELIVERIES', activeDeliveries), reason('ACTIVE_RETURN_PICKUPS', activeReturns), reason('PENDING_PAYOUTS', pendingPayouts), reason('PENDING_EARNINGS', dependencies.pendingEarningsNonZero)];
  const history = [reason('DELIVERY_HISTORY', deliveries), reason('RETURN_PICKUP_HISTORY', returns), reason('PAYOUT_HISTORY', payouts)];
  return baseAssessment('delivery', partnerId, dependencies, blocks, history);
};

const writeAudit = async ({ actorAdminId, source, assessment, outcome, session }) => {
  const action = outcome === 'failed' ? 'fail' : assessment.action;
  await AccountActionAudit.create([{
    actorAdminId, source, category: assessment.category, targetId: assessment.targetId,
    action, outcome, reasonCodes: assessment.reasonCodes,
    dependencyCounts: assessment.dependencies,
  }], session ? { session } : undefined);
};

const transactionUnsupported = (error) => /Transaction numbers are only allowed|replica set|transactions are not supported|does not support retryable writes/i.test(error?.message || '');

const runAtomic = async (work) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } catch (error) {
    if (!transactionUnsupported(error)) throw error;
    return work(null);
  } finally {
    await session.endSession();
  }
};

const updateUserRoleLink = async (userId, role, linkField, session) => {
  if (!userId) return;
  await User.updateOne({ _id: userId }, { $pull: { roles: role }, $unset: { [linkField]: '' } }, session ? { session } : undefined);
};

export const executeAccountAction = async ({ category, targetId, actorAdminId, source = 'admin' }) => {
  const assess = category === 'customer' ? assessCustomerAccount : category === 'seller' ? assessSellerAccount : assessDeliveryAccount;
  const assessment = await assess(targetId);
  if (!assessment) return null;
  if (assessment.action === 'skip') {
    await writeAudit({ actorAdminId, source, assessment, outcome: 'skipped' });
    return { ...assessment, outcome: 'skipped' };
  }

  try {
    const outcome = await runAtomic(async (session) => {
      const opts = session ? { session } : undefined;
      if (category === 'customer') {
        if (assessment.action === 'delete') await User.deleteOne({ _id: targetId }, opts);
        else await User.updateOne({ _id: targetId }, { $set: { isActive: false, pushTokens: [] }, $unset: { fcmToken: '' } }, opts);
      } else if (category === 'seller') {
        const seller = await Seller.findById(targetId).session(session || null);
        if (!seller) return 'deleted';
        if (assessment.action === 'delete') {
          await Seller.deleteOne({ _id: targetId }, opts);
          await updateUserRoleLink(seller.userId, 'seller', 'sellerId', session);
        } else {
          await Seller.updateOne({ _id: targetId }, { $set: { status: 'suspended', rejectionReason: 'Account archived by administrator' } }, opts);
          await User.updateOne(
            { _id: seller.userId },
            source === 'cleanup'
              ? { $set: { isActive: false, pushTokens: [] }, $pull: { roles: 'seller' }, $unset: { fcmToken: '' } }
              : { $pull: { roles: 'seller' } },
            opts,
          );
        }
      } else {
        const partner = await DeliveryPartner.findById(targetId).session(session || null);
        if (!partner) return 'deleted';
        if (assessment.action === 'delete') {
          await DeliveryPartner.deleteOne({ _id: targetId }, opts);
          await updateUserRoleLink(partner.userId, 'delivery', 'deliveryPartnerId', session);
        } else {
          await DeliveryPartner.updateOne({ _id: targetId }, { $set: { status: 'suspended', isAvailable: false, rejectionReason: 'Account archived by administrator' } }, opts);
          await User.updateOne(
            { _id: partner.userId },
            source === 'cleanup'
              ? { $set: { isActive: false, pushTokens: [] }, $pull: { roles: 'delivery' }, $unset: { fcmToken: '' } }
              : { $pull: { roles: 'delivery' } },
            opts,
          );
        }
      }
      await writeAudit({ actorAdminId, source, assessment, outcome: assessment.action === 'delete' ? 'deleted' : 'deactivated', session });
      return assessment.action === 'delete' ? 'deleted' : 'deactivated';
    });
    return { ...assessment, outcome };
  } catch (error) {
    await writeAudit({ actorAdminId, source, assessment, outcome: 'failed' }).catch(() => {});
    throw error;
  }
};
