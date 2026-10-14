import { calculateOptionB } from '../../services/quickCommerceFinance.service.js';

describe('Quick Commerce Option B allocation', () => {
  test.each([
    { customer: 30, freight: 50, contribution: 30, vendorShare: 20 },
    { customer: 50, freight: 50, contribution: 50, vendorShare: 0 },
    { customer: 75, freight: 50, contribution: 50, vendorShare: 0 },
  ])('allocates customer charge first: %#', ({ customer, freight, contribution, vendorShare }) => {
    const result = calculateOptionB({
      customerDeliveryCharge: customer,
      eligibleCourierFreight: freight,
      feeRule: { type: 'flat', value: 7.25, version: 'draft-v1' },
    });
    expect(result.customerFreightContribution).toBe(contribution);
    expect(result.vendorFreightShare).toBe(vendorShare);
    expect(result.bulkimartServiceFee).toBe(7.25);
    expect(result.vendorDeliveryFeeObligation).toBe(vendorShare + 7.25);
  });

  test('percentage service fee uses eligible courier freight and rounds to two decimals', () => {
    const result = calculateOptionB({
      customerDeliveryCharge: 10,
      eligibleCourierFreight: 33.33,
      feeRule: { type: 'percent', value: 7.5, version: 'draft-v2' },
    });
    expect(result.bulkimartServiceFee).toBe(2.5);
    expect(result.vendorFreightShare).toBe(23.33);
    expect(result.vendorDeliveryFeeObligation).toBe(25.83);
    expect(result.calculationBasis).toBe('eligible_courier_freight');
  });

  test.each([
    { feeRule: {}, message: /type is not configured/i },
    { feeRule: { type: 'flat', value: -1, version: 'v1' }, message: /incomplete/i },
    { feeRule: { type: 'percent', value: 101, version: 'v1' }, message: /technical range/i },
    { feeRule: { type: 'flat', value: 1 }, message: /incomplete/i },
  ])('fails closed for invalid fee configuration: %#', ({ feeRule, message }) => {
    expect(() => calculateOptionB({ customerDeliveryCharge: 10, eligibleCourierFreight: 20, feeRule })).toThrow(message);
  });

  test('rejects invalid money inputs', () => {
    expect(() => calculateOptionB({
      customerDeliveryCharge: -1, eligibleCourierFreight: 20,
      feeRule: { type: 'flat', value: 1, version: 'v1' },
    })).toThrow(/customer delivery charge/i);
  });
});
