import { requireFinancePermission } from '../middlewares/financePermission.middleware.js';
import { discountAllocation, DISCOUNT_FUNDING_POLICY, getDiscountFundingPolicy } from '../services/orderDiscounts.service.js';
import { financeFlags, requireFinanceOperation } from '../services/financeSafety.service.js';
import { calculateMarketplaceLine } from '../services/vendorCommission.service.js';

describe('Finance Permission & Discount Policy Verifications', () => {
  const origPolicy = process.env.DISCOUNT_FUNDING_POLICY;
  const origRef = process.env.FINANCE_POLICY_APPROVAL_REFERENCE;
  const origE2E = process.env.FINANCE_E2E_APPROVAL_REFERENCE;

  afterEach(() => {
    if (origPolicy !== undefined) process.env.DISCOUNT_FUNDING_POLICY = origPolicy;
    else delete process.env.DISCOUNT_FUNDING_POLICY;
    if (origRef !== undefined) process.env.FINANCE_POLICY_APPROVAL_REFERENCE = origRef;
    else delete process.env.FINANCE_POLICY_APPROVAL_REFERENCE;
    if (origE2E !== undefined) process.env.FINANCE_E2E_APPROVAL_REFERENCE = origE2E;
    else delete process.env.FINANCE_E2E_APPROVAL_REFERENCE;
  });

  test('SuperAdmin is permitted access even without manage_finance permission', () => {
    const req = { userType: 'admin', user: { role: 'superAdmin', permissions: [] } };
    let calledNext = false;
    let errorPassed = null;
    requireFinancePermission(req, {}, (err) => {
      calledNext = true;
      errorPassed = err;
    });
    expect(calledNext).toBe(true);
    expect(errorPassed).toBeUndefined();
  });

  test('Regular admin with manage_finance permission is permitted access', () => {
    const req = { userType: 'admin', user: { role: 'admin', permissions: ['manage_finance'] } };
    let calledNext = false;
    let errorPassed = null;
    requireFinancePermission(req, {}, (err) => {
      calledNext = true;
      errorPassed = err;
    });
    expect(calledNext).toBe(true);
    expect(errorPassed).toBeUndefined();
  });

  test('Regular admin without manage_finance permission is rejected with 403', () => {
    const req = { userType: 'admin', user: { role: 'admin', permissions: ['manage_sellers'] } };
    let errorPassed = null;
    requireFinancePermission(req, {}, (err) => {
      errorPassed = err;
    });
    expect(errorPassed).toBeDefined();
    expect(errorPassed.status).toBe(403);
    expect(errorPassed.message).toContain('manage_finance');
  });

  test('Non-admin user is rejected with 403', () => {
    const req = { userType: 'user', user: { role: 'buyer', permissions: ['manage_finance'] } };
    let errorPassed = null;
    requireFinancePermission(req, {}, (err) => {
      errorPassed = err;
    });
    expect(errorPassed).toBeDefined();
    expect(errorPassed.status).toBe(403);
  });

  test.each([
    ['no approval reference', {}],
    ['an approval reference', { FINANCE_POLICY_APPROVAL_REFERENCE: 'APPROVED-POLICY-REF' }],
    ['a legacy env override', { DISCOUNT_FUNDING_POLICY: 'unresolved' }],
  ])('coupon and coin discounts are always platform funded with %s', (_name, env) => {
    delete process.env.DISCOUNT_FUNDING_POLICY; delete process.env.FINANCE_POLICY_APPROVAL_REFERENCE;
    Object.assign(process.env, env);
    for (const pricing of [{ discountRepresentation: 'components-v1', subtotal: 100, couponDiscount: 10, totalAmount: 90 }, { discountRepresentation: 'components-v1', subtotal: 100, coinDiscount: 15, totalAmount: 85 }]) {
      const result = discountAllocation(pricing, [10000]);
      expect(result.fundingUnresolved).toBe(false);
      expect(result.fundingPolicy).toBe(DISCOUNT_FUNDING_POLICY.PLATFORM);
    }
    expect(getDiscountFundingPolicy()).toBe('platform');
  });

  test('orders without any discount record no funding policy', () => {
    expect(discountAllocation({ subtotal: 100, totalAmount: 100 }, [10000]).fundingPolicy).toBe('none');
  });

  test('marketplace line: commission on discounted price, seller paid on full price less withholding', () => {
    const rule = { method: 'percentage', value: 10, minimum: null, maximum: null, taxTreatment: 'exclusive', taxRate: 18 };
    expect(calculateMarketplaceLine(10000, 9000, rule, { tcsRatePercent: 0.5, tdsRatePercent: 0.1 }))
      .toEqual({ commissionPaise: 900, taxPaise: 162, tcsPaise: 50, tdsPaise: 10, gstRatePercent: 0, taxableValuePaise: 10000, platformDiscountPaise: 1000, netPaise: 8878 });
    expect(calculateMarketplaceLine(100, 0, { ...rule, method: 'fixed', value: 10 })).toMatchObject({ commissionPaise: 0, netPaise: 100 });
    expect(() => calculateMarketplaceLine(100, 100, { ...rule, method: 'fixed', value: 2, taxTreatment: 'exempt', taxRate: 0 })).toThrow(/exceed/);
  });

  test('financeFlags accurately reflects environment approval references', () => {
    process.env.FINANCE_POLICY_APPROVAL_REFERENCE = 'POL-REF-1';
    process.env.FINANCE_E2E_APPROVAL_REFERENCE = 'E2E-REF-1';
    const flags = financeFlags();
    expect(flags.policyApproved).toBe(true);
    expect(flags.testsApproved).toBe(true);
  });
});
