import { sellerFinancialAmounts, sellerOrderAmounts } from '../../services/sellerOrderAmounts.service.js';

const line = (sellerId, changes = {}) => ({ sellerId, grossPaise: 10000, eligiblePaise: 9000,
  allocatedDiscounts: { discount: 0, couponDiscount: 1000, cdsDiscount: 0, coinDiscount: 0 },
  rule: { method: 'percentage', value: 10 }, commissionPaise: 900, taxPaise: 162, tcsPaise: 50, tdsPaise: 10, netPaise: 8878, ...changes });

test('seller earnings read the saved commission, GST and withholding without exposing another seller', () => {
  const snapshot = { version: 2, lines: [line('seller'), line('other', { grossPaise: 999999 })] };
  expect(sellerFinancialAmounts(snapshot, 'seller')).toEqual({ subtotal: 100, discount: 0, couponDiscount: 10, cdsDiscount: 0,
    coinDiscount: 0, totalDiscount: 10, customerItemsTotal: 90, commission: 9, commissionTax: 1.62, tcs: .5, tds: .1, netEarnings: 88.78 });
});

test('missing commission evidence remains unavailable rather than full-price earnings', () => {
  for (const changes of [{ rule: null }, { netPaise: undefined }, { blocker: 'Missing policy' }]) {
    const amounts = sellerFinancialAmounts({ version: 2, lines: [line('seller', changes)] }, 'seller');
    expect(amounts.netEarnings).toBeNull(); expect(amounts.commission).toBeNull(); expect(amounts.couponDiscount).toBe(10);
  }
  expect(sellerFinancialAmounts(undefined, 'seller')).toBeNull();
  expect(sellerFinancialAmounts({ version: 2, lines: [line('other')] }, 'seller')).toBeNull();
});

test('new and legacy discount components allocate the exact same coupon once', () => {
  for (const pricing of [
    { subtotal: 100, couponDiscount: 10, totalAmount: 90, discountRepresentation: 'components-v1' },
    { subtotal: 100, discount: 10, couponDiscount: 10, totalAmount: 90 },
  ]) {
    const amounts = sellerOrderAmounts({ items: [{ sellerId: 'seller', price: 50, qty: 2 }], pricing }, 'seller');
    expect(amounts).toMatchObject({ subtotal: 100, couponDiscount: 10, discount: 0, customerItemsTotal: 90, netEarnings: null });
  }
});

test('rounding preserves every paisa of a multi-seller coupon', () => {
  const order = { items: ['a', 'b', 'c'].map(sellerId => ({ sellerId, price: 1, qty: 1 })),
    pricing: { subtotal: 3, couponDiscount: .01, totalAmount: 2.99, discountRepresentation: 'components-v1' } };
  const rows = ['a', 'b', 'c'].map(sellerId => sellerOrderAmounts(order, sellerId));
  expect(rows.map(row => row.couponDiscount)).toEqual([.01, 0, 0]);
  expect(rows.map(row => row.customerItemsTotal)).toEqual([.99, 1, 1]);
});

test('incomplete historical pricing never invents a payable or commission amount', () => {
  expect(sellerOrderAmounts({ items: [{ sellerId: 'seller', price: 100, qty: 1 }] }, 'seller'))
    .toMatchObject({ totalDiscount: null, customerItemsTotal: null, commission: null, netEarnings: null });
});
