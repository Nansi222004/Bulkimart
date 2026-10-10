import mongoose from 'mongoose';
import DonationSetting from '../models/DonationSetting.js';
import DonationTransaction, { DONATION_STATUS } from '../models/DonationTransaction.js';
import User from '../models/User.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, httpError, paginated } from '../utils/response.js';
import { getDonationSetting, loadDonationSetting, syncMissingDonationsFromOrders, validateDonationPreference } from '../services/donation.service.js';

/**
 * @desc    The active donation prompt config, for the checkout screen
 * @route   GET /api/donation-setting
 * @access  Public
 */
export const getDonationSettingPublic = asyncHandler(async (req, res) => {
  const setting = getDonationSetting();
  return ok(res, setting, 'Donation setting');
});

/**
 * @desc    The active donation setting + edit history, for the admin panel
 * @route   GET /api/admin/donation-setting
 * @access  Private/Admin
 */
export const getDonationSettingForAdmin = asyncHandler(async (req, res) => {
  const active = await DonationSetting.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
  const history = await DonationSetting.find().sort({ createdAt: -1 }).limit(50)
    .populate('updatedBy', 'name email').lean();

  const live = getDonationSetting();
  const current = active ? { ...active, source: 'configured' } : { ...live, source: 'default' };

  return ok(res, { current, history }, 'Donation setting');
});

/**
 * @desc    Replace the donation setting (insert-not-edit)
 * @route   POST /api/admin/donation-setting
 * @access  Private/Admin
 */
export const setDonationSettingForAdmin = asyncHandler(async (req, res) => {
  const {
    isEnabled, title, subtitle, knowMoreText,
    options, allowCustom, minCustomAmount, maxCustomAmount,
  } = req.body;

  const cleanOptions = Array.isArray(options)
    ? options.map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  if (!cleanOptions.length) throw httpError(400, 'Add at least one preset amount');

  const min = Number(minCustomAmount);
  const max = Number(maxCustomAmount);
  if (!Number.isFinite(min) || min <= 0) throw httpError(400, 'Minimum custom amount must be more than zero');
  if (!Number.isFinite(max) || max < min) throw httpError(400, 'Maximum custom amount must be at least the minimum');

  const session = await mongoose.startSession();
  let created;
  try {
    await session.withTransaction(async () => {
      await DonationSetting.updateMany({ isActive: true }, { $set: { isActive: false } }, { session });
      const [row] = await DonationSetting.create([{
        isEnabled: isEnabled === true || isEnabled === 'true',
        title: String(title || '').trim() || 'Donate & Support Transformative Social Work In India',
        subtitle: String(subtitle || '').trim(),
        knowMoreText: String(knowMoreText || '').trim(),
        options: cleanOptions,
        allowCustom: allowCustom === true || allowCustom === 'true',
        minCustomAmount: min,
        maxCustomAmount: max,
        isActive: true,
        updatedBy: req.user?._id,
      }], { session });
      created = row;
    });
  } finally {
    await session.endSession();
  }

  await loadDonationSetting();

  return ok(res, created, 'Donation setting updated');
});

/**
 * @desc    Get aggregated donation statistics for admin overview
 * @route   GET /api/admin/donations/overview
 * @access  Private/Admin
 */
export const getAdminDonationOverview = asyncHandler(async (req, res) => {
  await syncMissingDonationsFromOrders();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [agg] = await DonationTransaction.aggregate([
    {
      $facet: {
        totalCollected: [
          { $match: { status: { $in: [DONATION_STATUS.COLLECTED, DONATION_STATUS.DISBURSED] } } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ],
        todayCollected: [
          { $match: { status: { $in: [DONATION_STATUS.COLLECTED, DONATION_STATUS.DISBURSED] }, collectedAt: { $gte: startOfToday } } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ],
        monthCollected: [
          { $match: { status: { $in: [DONATION_STATUS.COLLECTED, DONATION_STATUS.DISBURSED] }, collectedAt: { $gte: startOfMonth } } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ],
        statusBreakdown: [
          { $group: { _id: '$status', count: { $sum: 1 }, sumAmount: { $sum: '$amount' } } },
        ],
        totalCount: [
          { $count: 'count' },
        ],
      },
    },
  ]);

  const totalCollected = agg.totalCollected[0]?.total || 0;
  const todayCollected = agg.todayCollected[0]?.total || 0;
  const monthCollected = agg.monthCollected[0]?.total || 0;
  const totalTransactions = agg.totalCount[0]?.count || 0;

  const statusMap = {};
  (agg.statusBreakdown || []).forEach((item) => {
    statusMap[item._id] = { count: item.count, amount: item.sumAmount };
  });

  return ok(res, {
    totalCollected,
    todayCollected,
    monthCollected,
    totalTransactions,
    collectedAmount: statusMap.COLLECTED?.amount || 0,
    refundedAmount: statusMap.REFUNDED?.amount || 0,
    disbursedAmount: statusMap.DISBURSED?.amount || 0,
    statusBreakdown: statusMap,
  }, 'Donation overview statistics');
});

/**
 * @desc    Get paginated donation transactions for admin with search & filter
 * @route   GET /api/admin/donations/transactions
 * @access  Private/Admin
 */
export const getAdminDonationTransactions = asyncHandler(async (req, res) => {
  await syncMissingDonationsFromOrders();
  const { page = 1, limit = 20, status, paymentMethod, search } = req.query;
  const query = {};

  if (status && Object.values(DONATION_STATUS).includes(status)) {
    query.status = status;
  }
  if (paymentMethod) {
    query.paymentMethod = paymentMethod;
  }

  if (search && String(search).trim()) {
    const term = String(search).trim();
    const regex = new RegExp(term, 'i');

    const matchingUsers = await User.find({
      $or: [{ name: regex }, { email: regex }, { phone: regex }],
    }).select('_id');
    const userIds = matchingUsers.map((u) => u._id);

    query.$or = [
      { transactionId: regex },
      { title: regex },
      { customerComment: regex },
      { userId: { $in: userIds } },
    ];
  }

  const skip = (Math.max(1, Number(page)) - 1) * Number(limit);

  const [transactions, total] = await Promise.all([
    DonationTransaction.find(query)
      .populate('userId', 'name email phone')
      .populate('orderId', 'orderNo pricing status createdAt')
      .populate('adminNotes.adminId', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    DonationTransaction.countDocuments(query),
  ]);

  return paginated(res, transactions, {
    page: Number(page),
    limit: Number(limit),
    total,
  });
});

/**
 * @desc    Get single donation transaction detail for admin
 * @route   GET /api/admin/donations/transactions/:id
 * @access  Private/Admin
 */
export const getAdminDonationDetail = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const transaction = await DonationTransaction.findById(id)
    .populate('userId', 'name email phone wallet')
    .populate('orderId')
    .populate('paymentId')
    .populate('adminNotes.adminId', 'name email')
    .lean();

  if (!transaction) throw httpError(404, 'Donation transaction not found');
  return ok(res, transaction, 'Donation transaction detail');
});

/**
 * @desc    Add an internal admin note to a donation record
 * @route   POST /api/admin/donations/transactions/:id/notes
 * @access  Private/Admin
 */
export const addAdminNoteToDonation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { note } = req.body;

  const cleanNote = String(note || '').trim();
  if (!cleanNote || cleanNote.length < 3) {
    throw httpError(400, 'Admin note must be at least 3 characters long');
  }

  const updated = await DonationTransaction.findByIdAndUpdate(
    id,
    {
      $push: {
        adminNotes: {
          note: cleanNote,
          adminId: req.user._id,
          createdAt: new Date(),
        },
      },
    },
    { new: true }
  ).populate('adminNotes.adminId', 'name email');

  if (!updated) throw httpError(404, 'Donation transaction not found');
  return ok(res, updated, 'Admin internal note added successfully');
});

/**
 * @desc    Update donation status (e.g. mark DISBURSED or REFUNDED)
 * @route   PATCH /api/admin/donations/transactions/:id/status
 * @access  Private/Admin
 */
export const updateDonationStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, reference, organizationName } = req.body;

  if (!Object.values(DONATION_STATUS).includes(status)) {
    throw httpError(400, 'Invalid donation status');
  }

  const update = { status };
  if (status === DONATION_STATUS.DISBURSED) {
    update.disbursedAt = new Date();
    if (organizationName) update['organizationDestination.name'] = String(organizationName).trim();
    if (reference) update['organizationDestination.reference'] = String(reference).trim();
  } else if (status === DONATION_STATUS.REFUNDED) {
    update.refundedAt = new Date();
  }

  const updated = await DonationTransaction.findByIdAndUpdate(id, { $set: update }, { new: true });
  if (!updated) throw httpError(404, 'Donation transaction not found');

  return ok(res, updated, `Donation status updated to ${status}`);
});

/**
 * @desc    Export donation transactions as CSV data
 * @route   GET /api/admin/donations/export
 * @access  Private/Admin
 */
export const exportDonationTransactionsCSV = asyncHandler(async (req, res) => {
  const transactions = await DonationTransaction.find()
    .populate('userId', 'name email phone')
    .populate('orderId', 'orderNo')
    .sort({ createdAt: -1 })
    .lean();

  const headers = [
    'Transaction ID', 'Customer Name', 'Customer Email', 'Customer Phone',
    'Order No', 'Amount (INR)', 'Payment Method', 'Customer Comment',
    'Status', 'Destination Name', 'Destination Reference', 'Created At', 'Collected At', 'Disbursed At'
  ];

  const rows = transactions.map((t) => [
    t.transactionId,
    t.userId?.name || 'N/A',
    t.userId?.email || 'N/A',
    t.userId?.phone || 'N/A',
    t.orderId?.orderNo || 'N/A',
    t.amount,
    t.paymentMethod || 'N/A',
    `"${(t.customerComment || '').replace(/"/g, '""')}"`,
    t.status,
    `"${(t.organizationDestination?.name || '').replace(/"/g, '""')}"`,
    `"${(t.organizationDestination?.reference || '').replace(/"/g, '""')}"`,
    t.createdAt ? new Date(t.createdAt).toISOString() : '',
    t.collectedAt ? new Date(t.collectedAt).toISOString() : '',
    t.disbursedAt ? new Date(t.disbursedAt).toISOString() : '',
  ]);

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="donation_transactions.csv"');
  return res.status(200).send(csvContent);
});

/**
 * @desc    Get customer's own donation history
 * @route   GET /api/user/donations
 * @access  Private (Customer)
 */
export const getCustomerDonations = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const skip = (Math.max(1, Number(page)) - 1) * Number(limit);

  const [donations, total] = await Promise.all([
    DonationTransaction.find({ userId: req.user._id })
      .populate('orderId', 'orderNo status createdAt')
      .select('transactionId amount title customerComment status paymentMethod collectedAt createdAt orderId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    DonationTransaction.countDocuments({ userId: req.user._id }),
  ]);

  return paginated(res, donations, {
    page: Number(page),
    limit: Number(limit),
    total,
  });
});

/**
 * @desc    Get authenticated user's persistent donation preference & validation status
 * @route   GET /api/donation-setting/preference
 * @route   GET /api/users/donation-preference
 * @access  Private (Customer)
 */
export const getDonationPreference = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('donationPreference').lean();
  if (!user) throw httpError(404, 'User not found');

  const pref = user.donationPreference || { enabled: false, amount: 0 };
  const validated = validateDonationPreference(pref);
  const setting = getDonationSetting();

  return ok(res, {
    preference: {
      enabled: Boolean(pref.enabled),
      amount: Number(pref.amount || 0),
      updatedAt: pref.updatedAt || null,
      valid: validated.valid,
      reason: validated.reason || null,
    },
    setting,
  }, 'User donation preference');
});

/**
 * @desc    Save/Update authenticated user's persistent donation preference
 * @route   PATCH /api/donation-setting/preference
 * @route   PATCH /api/users/donation-preference
 * @access  Private (Customer)
 */
export const updateDonationPreference = asyncHandler(async (req, res) => {
  const { enabled, amount } = req.body;
  const isEnabled = enabled === true || enabled === 'true';

  const setting = getDonationSetting();
  if (isEnabled) {
    if (!setting || !setting.isEnabled) {
      throw httpError(400, 'Donations are currently disabled by Admin.');
    }

    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      throw httpError(400, 'Please select a valid donation amount.');
    }

    const isPreset = (setting.options || []).some((o) => Number(o) === numAmount);
    const isValidCustom = setting.allowCustom
      && numAmount >= (setting.minCustomAmount ?? 1)
      && numAmount <= (setting.maxCustomAmount ?? 10000);

    if (!isPreset && !isValidCustom) {
      throw httpError(400, 'That donation amount is not currently available in system settings.');
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          'donationPreference.enabled': true,
          'donationPreference.amount': numAmount,
          'donationPreference.updatedAt': new Date(),
        },
      },
      { new: true }
    ).select('donationPreference');

    return ok(res, {
      preference: {
        enabled: true,
        amount: numAmount,
        updatedAt: updatedUser.donationPreference?.updatedAt,
        valid: true,
      },
    }, 'Donation preference saved');
  } else {
    // Disable preference
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          'donationPreference.enabled': false,
          'donationPreference.updatedAt': new Date(),
        },
      },
      { new: true }
    ).select('donationPreference');

    return ok(res, {
      preference: {
        enabled: false,
        amount: Number(updatedUser.donationPreference?.amount || 0),
        updatedAt: updatedUser.donationPreference?.updatedAt,
        valid: true,
      },
    }, 'Donation preference disabled');
  }
});


