/**
 * Single source of truth for every enum shared across models and controllers.
 *
 * NOTE: the grocery channel was previously spelled "qcommerce" in Category/Order/Banner
 * and "grocery" in Product/Cart. That mismatch made joins between them silently return
 * empty. "grocery" is now canonical everywhere.
 */

// ---------------------------------------------------------------- channels
export const CHANNEL = {
  ECOM: 'ecommerce',
  GROCERY: 'grocery',
  SHG: 'shg',
};
export const CHANNELS = Object.values(CHANNEL);

// Wholesale is an approved seller capability in this foundation phase, not
// yet a cart/order storefront channel. Keep it out of CHANNELS/ORDER_TYPES so
// existing public, cart, and checkout flows cannot accept it prematurely.
export const WHOLESALE_CHANNEL = 'wholesale';
export const SELLER_SALES_CHANNELS = [...CHANNELS.filter((channel) => channel !== CHANNEL.SHG), WHOLESALE_CHANNEL];
export const WHOLESALE_REQUEST_STATUS = {
  NOT_REQUESTED: 'not_requested',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  SUSPENDED: 'suspended',
};
export const WHOLESALE_REQUEST_STATUSES = Object.values(WHOLESALE_REQUEST_STATUS);

// Banners additionally support a cross-channel "general" placement
export const BANNER_TYPES = [...CHANNELS, 'general'];

// ---------------------------------------------------------------- orders
export const ORDER_STATUS = {
  PLACED: 'placed',
  CONFIRMED: 'confirmed',
  PREPARING: 'preparing',
  DISPATCHED: 'dispatched',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  RETURN_REQUESTED: 'return_requested',
  RETURNED: 'returned',
  REFUNDED: 'refunded',
};
export const ORDER_STATUSES = Object.values(ORDER_STATUS);

/** A buyer may only cancel while the order has not left the vendor. */
export const CANCELLABLE_STATUSES = [
  ORDER_STATUS.PLACED,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PREPARING,
];

/** Transitions a seller/SHG vendor is allowed to make. Never 'delivered' —
 *  only the delivery OTP flow may set that. */
/**
 * What a vendor may do to an order, and from where.
 *
 * Cancelling is allowed up to the moment the parcel leaves the shop. Once it is
 * dispatched a rider may already be holding it, and "cancel" would mean putting
 * stock back on a shelf that no longer has it — from there it is a return, not
 * a cancellation, and that is a different flow.
 */
export const VENDOR_ORDER_TRANSITIONS = {
  [ORDER_STATUS.PLACED]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.CONFIRMED]: [ORDER_STATUS.PREPARING, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PREPARING]: [ORDER_STATUS.DISPATCHED, ORDER_STATUS.CANCELLED],
};

/**
 * The same journey, but nobody from this company is carrying the parcel.
 *
 * An order handed to one of our riders stops being the shop's business at
 * `dispatched` — the rider takes it from there and reports every step. A parcel
 * handed to a courier is different: the courier does not talk to this system, so
 * the shop stays the reporter for the whole trip and needs the two states a
 * rider would otherwise have written.
 */
export const COURIER_VENDOR_TRANSITIONS = {
  ...VENDOR_ORDER_TRANSITIONS,
  [ORDER_STATUS.DISPATCHED]: [ORDER_STATUS.OUT_FOR_DELIVERY],
  [ORDER_STATUS.OUT_FOR_DELIVERY]: [ORDER_STATUS.DELIVERED],
};

/** Retained under its former name; the rule is about the carrier, not the channel. */
export const ECOM_VENDOR_TRANSITIONS = COURIER_VENDOR_TRANSITIONS;

/**
 * Which set of vendor moves applies, decided by who is carrying the parcel.
 *
 * This asked for a channel, and answered "e-commerce goes further". That was
 * right while Shop All meant courier. Same-Day is a Shop All order carried by
 * our own rider, and it must stop at `dispatched` like any other rider job — so
 * the question is the carrier. An order with no carrier recorded falls to the
 * rider set, which is the older and safer of the two.
 */
export const vendorTransitions = (carrier) =>
  carrier === 'shiprocket' ? COURIER_VENDOR_TRANSITIONS : VENDOR_ORDER_TRANSITIONS;

/** The states a vendor can still pull an order out of. */
export const VENDOR_CANCELLABLE_STATUSES = [
  ORDER_STATUS.PLACED,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PREPARING,
];

/**
 * When a rider may claim an order — one definition, used by both the offer and
 * the accept.
 *
 * These were two separate lists in two files, and they disagreed: riders were
 * being rung the moment a Quick order was confirmed, while accept still
 * insisted on `dispatched`. Every one of those offers ended in a 400, and the
 * rider had no way to tell why.
 *
 * Quick Commerce rings early on purpose. The rider starts towards the shop
 * while the order is still being packed, which is most of what makes ten-minute
 * delivery possible — waiting for the parcel to be ready before looking for
 * somebody to carry it adds the whole journey to the clock.
 *
 * Shop All has no such urgency: it is claimable only once it is actually ready.
 */
export const riderClaimableStatuses = (channel) =>
  channel === CHANNEL.GROCERY
    ? [ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING, ORDER_STATUS.DISPATCHED]
    : [ORDER_STATUS.DISPATCHED];

/**
 * One rider's response to being offered one order — distinct from
 * `ORDER_STATUS`, which tracks the order as a whole and has no idea a
 * particular rider ever saw it.
 *
 * Deliberately just the four states an offer itself passes through.
 * CANCELLED_BY_RIDER, FAILED_DELIVERY and the rest of the wider lifecycle
 * are order/delivery-level events for after an offer has already resolved
 * to ACCEPTED — they belong wherever that work lands, not here, so this
 * enum is not pre-loaded with states nothing yet writes.
 */
export const OFFER_ATTEMPT_STATUS = {
  OFFERED: 'OFFERED',
  ACCEPTED: 'ACCEPTED',
  DECLINED_BY_RIDER: 'DECLINED_BY_RIDER',
  OFFER_EXPIRED: 'OFFER_EXPIRED',
};
export const OFFER_ATTEMPT_STATUSES = Object.values(OFFER_ATTEMPT_STATUS);

export const ORDER_TYPES = [CHANNEL.ECOM, CHANNEL.GROCERY, 'subscription'];
export const DELIVERY_TYPES = ['shiprocket', 'internal'];

// ------------------------------------------------------- e-commerce delivery
/**
 * How a Shop All order reaches the customer.
 *
 * This is the customer's choice, and it is deliberately a separate idea from
 * `deliveryType` above. `deliveryType` names the *carrier* — our own rider, or a
 * courier — and stays the field every fulfilment check reads. `mode` names what
 * the customer was *offered and picked*, which is what a receipt has to show and
 * what a dispute needs months later.
 *
 * They map one to one today (SAME_DAY → internal, SCHEDULED → shiprocket) and
 * that is fine; recording both costs nothing and keeps the promise separable
 * from the mechanism if a third carrier ever appears.
 *
 * Quick Commerce has no mode. It has exactly one way of arriving, so an order
 * without this field is not a gap — it is a grocery order or one placed before
 * Same-Day existed.
 */
export const DELIVERY_MODE = {
  SAME_DAY: 'same_day',
  SCHEDULED: 'scheduled',
};
export const DELIVERY_MODES = Object.values(DELIVERY_MODE);

// ---------------------------------------------------------------- vendors
export const VENDOR_STATUS = {
  INCOMPLETE: 'incomplete',
  PENDING: 'pending',
  UNDER_REVIEW: 'under_review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  SUSPENDED: 'suspended',
};
export const VENDOR_STATUSES = Object.values(VENDOR_STATUS);

// SHG stores cannot be suspended in the current model
export const SHG_STATUSES = [
  VENDOR_STATUS.INCOMPLETE,
  VENDOR_STATUS.PENDING,
  VENDOR_STATUS.UNDER_REVIEW,
  VENDOR_STATUS.APPROVED,
  VENDOR_STATUS.REJECTED,
];

// ---------------------------------------------------------------- approvals
export const APPROVAL = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};
export const APPROVAL_STATUSES = Object.values(APPROVAL);

// ---------------------------------------------------------------- roles
export const ROLE = {
  BUYER: 'buyer',
  SELLER: 'seller',
  SHG: 'shg',
  DELIVERY: 'delivery',
};
export const ROLES = Object.values(ROLE);

// ---------------------------------------------------------------- payments
export const PAYMENT_METHOD = { ONLINE: 'online', WALLET: 'wallet', COD: 'cod' };
export const PAYMENT_METHODS = Object.values(PAYMENT_METHOD);

export const PAYMENT_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  PARTIAL_REFUND: 'partial_refund',
};
export const PAYMENT_STATUSES = Object.values(PAYMENT_STATUS);

// ---------------------------------------------------------------- delivery
export const DELIVERY_STATUS = {
  ASSIGNED: 'assigned',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  PICKED_UP: 'picked_up',
  IN_TRANSIT: 'in_transit',
  DELIVERED: 'delivered',
  FAILED: 'failed',
};
export const DELIVERY_STATUSES = Object.values(DELIVERY_STATUS);

// ------------------------------------------------------------- rider payout
/**
 * The two kinds of job a rider is paid for.
 *
 * Deliberately NOT the same idea as DELIVERY_MODE, even though the names
 * overlap. DELIVERY_MODE is what the customer chose and is only set on Shop All
 * orders; this is what the rider is doing, and a Quick order has no delivery
 * mode at all yet obviously still pays. Deriving one from the other is done in
 * exactly one place — payoutModeOf() in services/riderPay.service.js.
 */
export const PAYOUT_MODE = { QUICK: 'quick', SAME_DAY: 'same_day' };
export const PAYOUT_MODES = Object.values(PAYOUT_MODE);

/**
 * What a customer may tip their rider at checkout.
 *
 * A fixed ladder rather than a free-text box: a tip is a one-tap decision made
 * at the end of a checkout nobody wants to still be filling in, and an open
 * field invites both the fat-fingered ₹500 and the ₹0.01. These are the only
 * amounts the server will accept (see services/tip.service.js) — a request
 * naming anything else is rejected outright rather than clamped, because a
 * number that isn't on this list didn't come from the tip UI.
 */
export const TIP_PRESETS = [10, 20, 30, 40, 50];

// ---------------------------------------------------------------- subscriptions
export const PLAN_TYPE = {
  TEN_DAY: '10day',
  FIFTEEN_DAY: '15day',
  MONTHLY: 'monthly',
  CUSTOM: 'custom',
};
export const PLAN_TYPES = Object.values(PLAN_TYPE);
export const PLAN_DURATION_DAYS = { '10day': 10, '15day': 15, monthly: 30 };

export const SUBSCRIPTION_STATUS = {
  PENDING_SELLER_ACCEPTANCE: 'pending_seller_acceptance',
  ACTIVE: 'active',
  PAUSED: 'paused',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
};
export const SUBSCRIPTION_STATUSES = Object.values(SUBSCRIPTION_STATUS);

/** One rider's-side-mirrored lifecycle for a single scheduled delivery row. */
export const SUBSCRIPTION_DELIVERY_STATUS = {
  SCHEDULED: 'scheduled',
  PACKED: 'packed',
  DELIVERED: 'delivered',
  SKIPPED: 'skipped',
  FAILED: 'failed',
};
export const SUBSCRIPTION_DELIVERY_STATUSES = Object.values(SUBSCRIPTION_DELIVERY_STATUS);

export const SUBSCRIPTION_FREQUENCY = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly' };
export const SUBSCRIPTION_FREQUENCIES = Object.values(SUBSCRIPTION_FREQUENCY);

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * What one subscription delivery may weigh.
 *
 * A rider carries this on a two-wheeler alongside whatever else they are
 * holding. The ceiling is per DELIVERY, not per plan — a month of 5 kg drops is
 * thirty ordinary trips, while one 25 kg drop is a trip nobody can make.
 */
export const SUBSCRIPTION_MAX_WEIGHT_KG = Number(process.env.SUBSCRIPTION_MAX_WEIGHT_KG) || 20;

/** How many deliveries one plan may generate — a guard against a typo'd duration. */
export const SUBSCRIPTION_MAX_DELIVERIES = 90;

// ---------------------------------------------------------------- pricing
// The floor services/deliveryCharge.service.js falls back to before an
// admin has configured a real value. No free-delivery threshold — every
// order pays this (or whatever an admin sets), waived only by an empty
// cart or a free-shipping coupon.
export const DEFAULT_DELIVERY_CHARGE = 40;
export const LOW_STOCK_THRESHOLD = 20;

// ------------------------------------------------------------ same-day rules
const envNumber = (key, fallback) => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

// ------------------------------------------------------------ rider payouts
/** Smallest amount a rider may request out of `earnings.pending` in one go. */
export const DELIVERY_MIN_PAYOUT_AMOUNT = envNumber('DELIVERY_MIN_PAYOUT_AMOUNT', 100);

export const DELIVERY_PAYOUT_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
};
export const DELIVERY_PAYOUT_STATUSES = Object.values(DELIVERY_PAYOUT_STATUS);

// ------------------------------------------------------------ NHCONE Coins
/**
 * 1 Coin = ₹1 (coinValue below). Every numeric rule (earn %, redemption
 * threshold, max redemption %) is admin-configurable — see CoinConfig.js —
 * these are only the pre-configuration defaults, same role
 * DEFAULT_DELIVERY_CHARGE plays for DeliveryChargeSetting.
 */
export const COIN_DEFAULTS = {
  EARN_PERCENTAGE: 10,
  COIN_VALUE: 1,
  MINIMUM_REDEMPTION_ORDER_VALUE: 500,
  MAXIMUM_REDEMPTION_PERCENTAGE: 20,
};

export const COIN_TRANSACTION_TYPE = {
  EARN: 'EARN',
  RESERVE: 'RESERVE',
  RELEASE: 'RELEASE',
  REDEEM: 'REDEEM',
  REFUND: 'REFUND',
  REVERSAL: 'REVERSAL',
  ADJUSTMENT: 'ADJUSTMENT',
  EXPIRY: 'EXPIRY', // reserved for future use — no automatic expiry implemented in V1
};
export const COIN_TRANSACTION_TYPES = Object.values(COIN_TRANSACTION_TYPE);

export const COIN_REFERENCE_TYPE = {
  ORDER: 'ORDER',
  ORDER_ITEM: 'ORDER_ITEM',
  PAYMENT: 'PAYMENT',
  ADMIN: 'ADMIN',
  SYSTEM: 'SYSTEM',
  // Referral Program — every Coin credited under this reference type is
  // funded entirely by Admin (see metadata.fundedBy on the credit itself),
  // never by the referred order's own margin.
  REFERRAL: 'REFERRAL',
};
export const COIN_REFERENCE_TYPES = Object.values(COIN_REFERENCE_TYPE);

// Per-order-item Coin reward lifecycle (Phase 7). Absent (undefined) on any
// item delivered before this phase existed — deliberately never backfilled,
// so a legacy order already credited under the old immediate-earn behavior
// is never touched or re-evaluated (Section 20).
export const COIN_REWARD_STATUS = {
  PENDING:  'PENDING',  // delivered, waiting for its own return-window/active-return resolution
  ELIGIBLE: 'ELIGIBLE', // resolved, amount computed, credit not yet confirmed written
  CREDITED: 'CREDITED', // Coins actually credited to the wallet
  BLOCKED:  'BLOCKED',  // resolved to a zero-value reward (e.g. fully refunded) — terminal, nothing to credit
};
export const COIN_REWARD_STATUSES = Object.values(COIN_REWARD_STATUS);

// ------------------------------------------------------------ returns / refunds
/**
 * A sanity ceiling on Admin-configured return windows — guards against a
 * fat-fingered "700" instead of "7". Not a business rule on its own; Admin
 * can still set anything at or below this.
 */
export const RETURN_POLICY_MAX_WINDOW_DAYS = envNumber('RETURN_POLICY_MAX_WINDOW_DAYS', 90);

/**
 * The furthest a shop may promise Same-Day, in kilometres.
 *
 * Platform-controlled and deliberately not a seller field. A seller may narrow
 * their own radius below this, never widen past it — the ceiling is applied
 * server-side, and the Seller schema also refuses a larger value outright so a
 * bad write cannot get in behind a controller.
 */
export const SAME_DAY_MAX_RADIUS_KM = envNumber('SAME_DAY_MAX_RADIUS_KM', 20);

/**
 * General seller product-visibility radius — a different, wider ceiling
 * from Same-Day's own `SAME_DAY_MAX_RADIUS_KM` above. A seller not
 * offering Same-Day at all can still set a plain service radius (e.g. "I
 * only deliver within 50km"), and the two numbers are unrelated: a seller
 * could have a 50km general radius but only a 10km Same-Day radius within it.
 */
export const SELLER_SERVICE_MAX_RADIUS_KM = envNumber('SELLER_SERVICE_MAX_RADIUS_KM', 50);

/** Ceiling for a delivery partner's own configurable pickup radius. */
export const DELIVERY_PARTNER_MAX_RADIUS_KM = envNumber('DELIVERY_PARTNER_MAX_RADIUS_KM', 50);

/**
 * What Same-Day fulfilment adds to the customer's bill on the seller's behalf.
 *
 * Three things this is NOT, each of which was a real possibility worth ruling
 * out in writing:
 *
 *   - It is not a second product price. `Product.price` is untouched by
 *     Same-Day; a ₹150 item is displayed and charged at ₹150.
 *   - It is not the delivery fee. That is a separate line, charged for carrying
 *     the parcel; this one is charged for fulfilling it quickly.
 *   - It is not evidence that the seller has been paid. There is no settlement
 *     engine in this codebase yet — `Commission` is imported by nothing and
 *     `Seller.commissionRate` is never read by any calculation. The customer
 *     pays this amount and the order records it; who receives it, and when, is
 *     a build that does not exist.
 *
 * The seller never enters this number.
 */
export const SAME_DAY_SELLER_INCENTIVE = envNumber('SAME_DAY_SELLER_INCENTIVE', 10);

/** Longest processing time a seller may claim and still be offering "same day". */
export const SAME_DAY_MAX_PROCESSING_MINUTES = envNumber('SAME_DAY_MAX_PROCESSING_MINUTES', 480);

/**
 * What the customer pays to have a parcel carried the same day.
 *
 * Flat for now, and separate from the rider's payout on purpose — the two are
 * different amounts moving in different directions, and equating them is how a
 * platform accidentally works for free. The rider's rates stay in
 * riderPay.service and are not read here.
 *
 * Distance is already computed by the time this is applied, so turning this into
 * a per-kilometre rule later is a change in one function.
 */
export const SAME_DAY_DELIVERY_FEE = envNumber('SAME_DAY_DELIVERY_FEE', 30);

/**
 * Which carrier a chosen delivery mode implies.
 *
 * One mapping, kept next to the modes themselves, so the four places that decide
 * how a parcel travels cannot each invent their own version of it.
 */
export const carrierForMode = (mode) =>
  mode === DELIVERY_MODE.SAME_DAY ? 'internal' : 'shiprocket';

// ---------------------------------------------------------------- support tickets
export const TICKET_REQUESTER_ROLE = {
  CUSTOMER: 'customer',
  SELLER: 'seller',
  SHG: 'shg',
  DELIVERY: 'delivery',
};
export const TICKET_REQUESTER_ROLES = Object.values(TICKET_REQUESTER_ROLE);

export const TICKET_STATUS = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING_FOR_USER: 'WAITING_FOR_USER',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
  REOPENED: 'REOPENED',
};
export const TICKET_STATUSES = Object.values(TICKET_STATUS);

/**
 * Legacy tickets (created before this system existed) used capitalized
 * 'Open'/'Resolved' — Mongoose doesn't validate on read, so those documents
 * still load fine; this just lets response-serialising code normalise them
 * to the current vocabulary without a data migration.
 */
export const LEGACY_TICKET_STATUS_MAP = {
  Open: TICKET_STATUS.OPEN,
  Resolved: TICKET_STATUS.RESOLVED,
};

/** Requester-initiated transitions — see ticket.service.js::assertValidTransition. */
export const TICKET_REQUESTER_TRANSITIONS = {
  [TICKET_STATUS.RESOLVED]: [TICKET_STATUS.REOPENED],
};

/** Admin-initiated transitions via the generic status-change endpoint. */
export const TICKET_ADMIN_TRANSITIONS = {
  [TICKET_STATUS.OPEN]: [TICKET_STATUS.IN_PROGRESS],
  [TICKET_STATUS.IN_PROGRESS]: [TICKET_STATUS.WAITING_FOR_USER, TICKET_STATUS.RESOLVED],
  [TICKET_STATUS.WAITING_FOR_USER]: [TICKET_STATUS.IN_PROGRESS],
  [TICKET_STATUS.RESOLVED]: [TICKET_STATUS.CLOSED],
  [TICKET_STATUS.REOPENED]: [TICKET_STATUS.IN_PROGRESS],
};

export const TICKET_CATEGORIES_BY_ROLE = {
  [TICKET_REQUESTER_ROLE.CUSTOMER]: [
    'Order', 'Payment', 'Delivery', 'Product', 'Refund / Cancellation',
    'Account', 'Subscription', 'Technical Issue', 'Other',
  ],
  [TICKET_REQUESTER_ROLE.SELLER]: [
    'Order', 'Payment / Payout', 'Product', 'Delivery', 'Account / KYC',
    'Subscription', 'Campaign', 'Advertisement / Promotion', 'Technical Issue', 'Other',
  ],
  [TICKET_REQUESTER_ROLE.SHG]: [
    'Order', 'Payment / Payout', 'Product', 'Delivery', 'Account',
    'Subscription', 'Campaign', 'Advertisement / Promotion', 'Technical Issue', 'Other',
  ],
  [TICKET_REQUESTER_ROLE.DELIVERY]: [
    'Order / Delivery', 'Pickup Issue', 'Customer Issue', 'Payment / Earnings',
    'Withdrawal / Payout', 'Account', 'KYC / Verification', 'App / Technical Issue', 'Other',
  ],
};

export const TICKET_ATTACHMENT_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
];
export const TICKET_MAX_ATTACHMENTS = 5;

// ------------------------------------------------------------ returns (item-level, Phase 4)
export const RETURN_STATUS = {
  RETURN_REQUESTED: 'RETURN_REQUESTED',
  UNDER_REVIEW:      'UNDER_REVIEW',
  APPROVED:          'APPROVED',
  AWAITING_RETURN:   'AWAITING_RETURN',
  RETURN_RECEIVED:   'RETURN_RECEIVED',
  REFUND_PENDING:    'REFUND_PENDING',
  REFUND_FAILED:     'REFUND_FAILED',
  REFUNDED:          'REFUNDED',
  REJECTED:          'REJECTED',
  CANCELLED:         'CANCELLED',
};
export const RETURN_STATUSES = Object.values(RETURN_STATUS);

// Statuses reachable ONLY through the dedicated refund service (Phase 6) —
// never through the generic admin status-transition endpoint.
export const RETURN_REFUND_MACHINERY_STATUSES = [
  RETURN_STATUS.REFUND_PENDING, RETURN_STATUS.REFUND_FAILED, RETURN_STATUS.REFUNDED,
];

// Tracks whether the ONE allowed inventory mutation for a RESTOCKABLE return
// has actually happened yet — separate from `restockDecision` (the admin's
// intent), so a retry/duplicate request can never increment stock twice.
export const RESTOCK_STATUS = {
  NOT_PROCESSED: 'NOT_PROCESSED',
  RESTOCKED:     'RESTOCKED',
  NOT_RESTOCKED: 'NOT_RESTOCKED',
};
export const RESTOCK_STATUSES = Object.values(RESTOCK_STATUS);

// Return.refundStatus — 'manual_pending' is the explicit, honest state for a
// COD order: no real gateway/bank-transfer mechanism exists to move money
// back automatically (Phase 6M), so this sits here until an admin manually
// confirms the cash was actually returned to the customer.
export const RETURN_REFUND_STATUS = {
  PENDING:         'pending',
  PROCESSING:      'processing',
  MANUAL_PENDING:  'manual_pending',
  COMPLETED:       'completed',
  FAILED:          'failed',
};
export const RETURN_REFUND_STATUSES = Object.values(RETURN_REFUND_STATUS);

/** Statuses that release a return's reserved quantity back to "returnable". */
export const RETURN_QUANTITY_RELEASING_STATUSES = [RETURN_STATUS.REJECTED, RETURN_STATUS.CANCELLED];

export const RETURN_REASON = {
  DAMAGED:          'DAMAGED',
  DEFECTIVE:        'DEFECTIVE',
  WRONG_PRODUCT:    'WRONG_PRODUCT',
  WRONG_SIZE:       'WRONG_SIZE',
  NOT_AS_DESCRIBED: 'NOT_AS_DESCRIBED',
  MISSING_PARTS:    'MISSING_PARTS',
  QUALITY_ISSUE:    'QUALITY_ISSUE',
  OTHER:            'OTHER',
};
export const RETURN_REASONS = Object.values(RETURN_REASON);

export const RESTOCK_DECISION = {
  RESTOCKABLE:     'RESTOCKABLE',
  NON_RESTOCKABLE: 'NON_RESTOCKABLE',
};
export const RESTOCK_DECISIONS = Object.values(RESTOCK_DECISION);

export const RETURN_ATTACHMENT_MIME_TYPES = TICKET_ATTACHMENT_MIME_TYPES;
export const RETURN_MAX_ATTACHMENTS = 5;

/**
 * QUICK COMMERCE ONLY — the reverse-pickup leg of a Return, tracked
 * separately from `Return.status` (Section 21 of the reverse-delivery
 * spec): a rider's own movement is a DELIVERY concept, not a REFUND-eligibility
 * concept, so it never overloads RETURN_STATUS. Deliberately small — the
 * fine-grained trip stages (accepted/picked_up/etc.) live on the reused
 * `Delivery.status` enum, exactly as they do for a forward delivery; this is
 * only the coarse "where is this pickup at" a Seller/Admin screen filters on.
 */
export const RETURN_PICKUP_STATUS = {
  NOT_ASSIGNED:        'NOT_ASSIGNED',
  ASSIGNED:            'ASSIGNED',
  PICKED_UP:           'PICKED_UP',
  DELIVERED_TO_SELLER: 'DELIVERED_TO_SELLER',
  CANCELLED:           'CANCELLED',
};
export const RETURN_PICKUP_STATUSES = Object.values(RETURN_PICKUP_STATUS);

// ------------------------------------------------------------ Referral Program
/**
 * One row per referred person (Referral model). Mirrors the shape of
 * COIN_REWARD_STATUS above on purpose — same "resolve once, credit once"
 * lifecycle, just at the referral level instead of the order-item level.
 *
 *   PENDING   — referee signed up, first qualifying order not yet resolved
 *   QUALIFIED — atomically claimed by the sweeper; payout in progress
 *   CREDITED  — Coins actually in the referrer's wallet (terminal)
 *   BLOCKED   — fraud flag / budget exhausted / admin rejection (terminal)
 *   EXPIRED   — referee never placed a qualifying order within the window (terminal)
 */
export const REFERRAL_STATUS = {
  PENDING:   'PENDING',
  QUALIFIED: 'QUALIFIED',
  CREDITED:  'CREDITED',
  BLOCKED:   'BLOCKED',
  EXPIRED:   'EXPIRED',
};
export const REFERRAL_STATUSES = Object.values(REFERRAL_STATUS);

/** Terminal states — a referral in one of these is never re-evaluated by the sweeper. */
export const REFERRAL_TERMINAL_STATUSES = [
  REFERRAL_STATUS.CREDITED, REFERRAL_STATUS.BLOCKED, REFERRAL_STATUS.EXPIRED,
];

export const REFERRAL_BLOCKED_REASON = {
  SELF_REFERRAL:              'SELF_REFERRAL',
  BUDGET_EXHAUSTED:           'BUDGET_EXHAUSTED',
  VELOCITY_LIMIT:             'VELOCITY_LIMIT',
  ADMIN_REJECTED:             'ADMIN_REJECTED',
  PROGRAM_DISABLED:           'PROGRAM_DISABLED',
  BELOW_MINIMUM_ORDER_VALUE:  'BELOW_MINIMUM_ORDER_VALUE',
  ZERO_REWARD:                'ZERO_REWARD',
};

/** Pre-configuration defaults — same role COIN_DEFAULTS plays for CoinConfig. */
export const REFERRAL_DEFAULTS = {
  PER_REFERRAL_COINS: 100,
  MILESTONES: [
    { count: 5, bonusCoins: 500 },
    { count: 10, bonusCoins: 1000 },
    { count: 25, bonusCoins: 2500 },
    { count: 50, bonusCoins: 5000 },
  ],
  MIN_QUALIFYING_ORDER_VALUE: 299,
  // Credited to the REFEREE (B), same eligibility gate and same moment as
  // the referrer's own reward — NOT an instant signup bonus. See
  // referral.service.js::payoutReferral.
  REFEREE_REWARD_COINS: 50,
  REFERRAL_VALIDITY_DAYS: 30, // referee must place a qualifying order within this window
  MAX_REFERRALS_PER_USER_PER_MONTH: 50,
  MONTHLY_BUDGET_COINS: 0, // 0 = unlimited
  REQUIRE_MANUAL_APPROVAL_ABOVE: 0, // 0 = never require manual approval
};
