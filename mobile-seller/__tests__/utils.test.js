import { countText, kpiMoney, money, orderMoney, paiseMoney } from '../src/utils/format';
import { isValidIndianMobile, normalizePhoneInput, sellerOtpPayload } from '../src/utils/phone';
import { canCancelPaid, canCancelUnpaid, isEditable, istToIso, isoToIstParts, adMoney } from '../src/utils/advertising';
import { isRetiredSellerNotification, notificationTarget } from '../src/utils/notificationRouting';
import { readOrderFinance, readSellerFinances, validPayoutAmount, validProductTax } from '../src/utils/financeRead';
import { actionsFor, matchesOrderTab, sellerOrderTotal } from '../src/utils/orderAmounts';
import { editableOffer, hasWholesaleAccess, offerPayload, validateWholesaleOffer } from '../src/utils/wholesale';

const OID = 'a'.repeat(24);

describe('money formatting never shows ₹0 for missing values', () => {
  test('money', () => {
    expect(money(123456.7)).toBe('₹1,23,456.70');
    expect(money(undefined)).toBe('—');
    expect(money(null)).toBe('—');
    expect(money(NaN)).toBe('—');
    expect(money('100')).toBe('—');
  });
  test('kpiMoney', () => {
    expect(kpiMoney(null)).toBe('Pending calculation');
    expect(kpiMoney(undefined)).toBe('—');
    expect(kpiMoney(0)).toBe('₹0.00');
  });
  test('orderMoney / countText / paiseMoney', () => {
    expect(orderMoney(undefined)).toBe('—');
    expect(countText(undefined)).toBe('—');
    expect(countText(5)).toBe('5');
    expect(paiseMoney(12345)).toBe('₹123.45');
    expect(paiseMoney(null)).toBe('—');
  });
});

describe('phone', () => {
  test('normalises Indian prefixes', () => {
    expect(normalizePhoneInput('+91 98765 43210')).toBe('9876543210');
    expect(normalizePhoneInput('09876543210')).toBe('9876543210');
    expect(normalizePhoneInput('00919876543210')).toBe('9876543210');
  });
  test('validates', () => {
    expect(isValidIndianMobile('9876543210')).toBe(true);
    expect(isValidIndianMobile('5876543210')).toBe(false);
  });
  test('OTP payload defaults intent to login', () => {
    expect(sellerOtpPayload('9876543210', 'x', 1234)).toEqual({ phone: '9876543210', otp: '1234', intent: 'login' });
    expect(sellerOtpPayload('9876543210', 'register')).toEqual({ phone: '9876543210', intent: 'register' });
  });
});

describe('advertising rules', () => {
  const draft = { review: 'DRAFT', funding: 'UNPAID', delivery: 'NOT_SCHEDULED' };
  test('editable only while unpaid and unscheduled', () => {
    expect(isEditable(draft)).toBe(true);
    expect(isEditable({ ...draft, review: 'PENDING_REVIEW' })).toBe(false);
    expect(isEditable({ ...draft, funding: 'FUNDED' })).toBe(false);
  });
  test('cancel paths are exclusive', () => {
    expect(canCancelUnpaid(draft)).toBe(true);
    expect(canCancelPaid(draft)).toBe(false);
    const live = { review: 'APPROVED', funding: 'FUNDED', delivery: 'ACTIVE' };
    expect(canCancelUnpaid(live)).toBe(false);
    expect(canCancelPaid(live)).toBe(true);
    expect(canCancelPaid({ ...live, delivery: 'COMPLETED' })).toBe(false);
  });
  test('IST conversion round-trips', () => {
    expect(istToIso('2026-11-05', '09:30')).toBe('2026-11-05T09:30:00+05:30');
    expect(istToIso('2026-11-05', '25:00')).toBeNull();
    expect(isoToIstParts('2026-11-05T04:00:00.000Z')).toEqual({ date: '2026-11-05', time: '09:30' });
  });
  test('adMoney needs integer paise', () => {
    expect(adMoney(150000)).toBe('₹1,500.00');
    expect(adMoney(1.5)).toBe('Not configured');
  });
});

describe('notification routing', () => {
  test('targets', () => {
    expect(notificationTarget({ route: `/seller/orders/${OID}` })).toEqual({ screen: 'OrderDetail', params: { id: OID } });
    expect(notificationTarget({ metadata: { returnId: OID } }).screen).toBe('ReturnDetail');
    expect(notificationTarget({ route: `/seller/advertising?campaign=${OID}` })).toEqual({ screen: 'CampaignDetail', params: { id: OID } });
    expect(notificationTarget({ route: '/seller/faqs' })).toEqual({ screen: 'ProductFaqs' });
    expect(notificationTarget({ route: '/seller/earnings' })).toEqual({ screen: 'Tabs', params: { screen: 'Earnings' } });
    expect(notificationTarget({ route: '/somewhere-else' })).toBeNull();
  });
  test('rejects invalid ids', () => {
    expect(notificationTarget({ metadata: { orderId: 'not-an-id' } })).toBeNull();
  });
  test('retired promotion filter', () => {
    expect(isRetiredSellerNotification({ type: 'promotion' })).toBe(true);
    expect(isRetiredSellerNotification({ route: '/seller/advertising' })).toBe(false);
  });
});

describe('finance validators fail closed', () => {
  const balances = { earnedEarnings: 10, pending: 1, held: 0, eligible: 2, reserved: 0, settled: 7, quickFreightObligations: 0, bulkimartServiceFees: 0 };
  const summary = { success: true, data: { balances, payoutActionsEnabled: true, payouts: [] } };
  const ledger = { success: true, data: [{ _id: '1', amount: 5, direction: 'credit', bucket: 'settled' }] };
  test('accepts a complete response', () => {
    expect(readSellerFinances(summary, ledger).summary.balances.settled).toBe(7);
  });
  test('rejects a missing balance instead of showing zero', () => {
    const { settled, ...partial } = balances;
    expect(() => readSellerFinances({ success: true, data: { ...summary.data, balances: partial } }, ledger)).toThrow(/not zero/);
  });
  test('rejects a bad ledger row', () => {
    expect(() => readSellerFinances(summary, { success: true, data: [{ _id: '1', amount: -5, direction: 'credit', bucket: 'settled' }] })).toThrow();
  });
  test('order finance needs integer paise', () => {
    expect(() => readOrderFinance({ success: true, data: { entries: [], merchandise: { lines: [{ allocatedDiscounts: {}, grossPaise: 1.5, eligiblePaise: 1 }], components: {} } } })).toThrow();
    expect(readOrderFinance({ success: true, data: { entries: [] } })).toEqual({ entries: [] });
  });
  test('product tax must add up', () => {
    const tax = { version: 'product-gst-v1', sellingPricePaise: 11800, grossPaise: 11800, taxableValuePaise: 10000, gstPaise: 1800, addedGstPaise: 0, includedGstPaise: 1800,
      rates: [{ gstRate: 18, gstPriceType: 'inclusive', gstPaise: 1800, taxableValuePaise: 10000 }] };
    expect(validProductTax(tax)).toBe(true);
    expect(validProductTax({ ...tax, gstPaise: 1700 })).toBe(false);
  });
  test('payout amount', () => {
    expect(validPayoutAmount(100.5)).toBe(true);
    expect(validPayoutAmount(100.555)).toBe(false);
    expect(validPayoutAmount(0)).toBe(false);
  });
});

describe('orders', () => {
  test('actions come only from the server', () => {
    expect(actionsFor({})).toEqual([]);
    expect(actionsFor({ permittedActions: ['confirm'] })).toEqual(['confirm']);
  });
  test('total picks a server field', () => {
    expect(sellerOrderTotal({ pricing: { totalAmount: 50 } })).toEqual({ label: 'Order total', value: 50 });
  });
  test('tabs', () => {
    expect(matchesOrderTab({ status: 'preparing' }, 'pending')).toBe(true);
    expect(matchesOrderTab({ status: 'preparing' }, 'confirmed')).toBe(true);
    expect(matchesOrderTab({ status: 'delivered' }, 'pending')).toBe(false);
  });
});

describe('wholesale offer rules (port of the web validator)', () => {
  const ok = { enabled: true, minimumQuantity: '10', quantityIncrement: '5', priceTiers: [{ minimumQuantity: '10', unitPrice: '90' }, { minimumQuantity: '20', unitPrice: '85.50' }] };
  test('valid offer', () => {
    expect(validateWholesaleOffer(ok, 100)).toEqual({});
  });
  test('disabled offer needs nothing', () => {
    expect(validateWholesaleOffer({ enabled: false }, 0)).toEqual({});
  });
  test('MOQ above stock', () => {
    expect(validateWholesaleOffer(ok, 5).minimumQuantity).toMatch(/stock/);
  });
  test('tier not aligned to increment', () => {
    const bad = { ...ok, priceTiers: [ok.priceTiers[0], { minimumQuantity: '22', unitPrice: '80' }] };
    expect(validateWholesaleOffer(bad, 100)['tier.1.quantity']).toBeTruthy();
  });
  test('higher tier cannot cost more', () => {
    const bad = { ...ok, priceTiers: [ok.priceTiers[0], { minimumQuantity: '20', unitPrice: '95' }] };
    expect(validateWholesaleOffer(bad, 100)['tier.1.price']).toBeTruthy();
  });
  test('three decimals rejected', () => {
    const bad = { ...ok, priceTiers: [{ minimumQuantity: '10', unitPrice: '90.555' }] };
    expect(validateWholesaleOffer(bad, 100)['tier.0.price']).toBeTruthy();
  });
  test('payload converts to numbers', () => {
    expect(offerPayload(ok)).toEqual({ enabled: true, minimumQuantity: 10, quantityIncrement: 5, priceTiers: [{ minimumQuantity: 10, unitPrice: 90 }, { minimumQuantity: 20, unitPrice: 85.5 }] });
    expect(offerPayload({ enabled: false, minimumQuantity: 3 })).toEqual({ enabled: false });
  });
  test('editable copy round-trips', () => {
    expect(offerPayload(editableOffer(offerPayload(ok)))).toEqual(offerPayload(ok));
  });
  test('access needs an approved Wholesale channel', () => {
    expect(hasWholesaleAccess({ status: 'approved', wholesaleChannel: { status: 'approved' }, salesChannels: ['wholesale'] })).toBe(true);
    expect(hasWholesaleAccess({ status: 'approved', wholesaleChannel: { status: 'pending' }, salesChannels: ['wholesale'] })).toBe(false);
    expect(hasWholesaleAccess({ status: 'approved', wholesaleChannel: { status: 'approved' }, salesChannels: [] })).toBe(false);
  });
});
