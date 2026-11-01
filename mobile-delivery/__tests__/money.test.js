import { codCashDuePaise, codDueRupees, codReportLimitPaise, formatPaise, formatRupees, rupeesToPaise, validateCodCollection } from '../src/utils/money';

// Server rule: backend/utils/financeMoney.js codCashDuePaise; server codAmount = Math.round(pricing.totalAmount).
const serverCodAmount = (totalRupees) => Math.round(totalRupees);

describe('codCashDuePaise matches the backend rounding rule', () => {
  test.each([
    [83900, 83900],   // whole amount
    [83920, 83900],   // .20 rounds down
    [83949, 83900],   // .49 rounds down
    [83950, 84000],   // half rounds up
    [83999, 84000],   // .99 rounds up
    [50, 100],        // ₹0.50 -> ₹1
    [49, 0],          // ₹0.49 -> ₹0
  ])('%i paise -> %i paise', (expected, due) => {
    expect(codCashDuePaise(expected)).toBe(due);
  });

  test('server codAmount and codCashDuePaise agree for two-decimal totals (no float drift)', () => {
    for (let paise = 0; paise <= 200000; paise += 7) {
      const rupees = paise / 100;
      expect(serverCodAmount(rupees) * 100).toBe(codCashDuePaise(paise));
    }
  });
});

describe('codDueRupees uses the server figure without re-rounding', () => {
  test('COD order with integer codAmount', () => expect(codDueRupees({ paymentMethod: 'COD', codAmount: 840 })).toBe(840));
  test('prepaid order has no cash due', () => expect(codDueRupees({ paymentMethod: 'Prepaid', codAmount: 0 })).toBeNull());
  test('a non-integer amount from the server is refused, not rounded', () => expect(codDueRupees({ paymentMethod: 'COD', codAmount: 839.5 })).toBeNull());
  test('missing or zero amount is refused', () => {
    expect(codDueRupees({ paymentMethod: 'COD' })).toBeNull();
    expect(codDueRupees({ paymentMethod: 'COD', codAmount: 0 })).toBeNull();
  });
});

describe('validateCodCollection accepts only the exact rounded amount', () => {
  test('exact amount passes', () => expect(validateCodCollection('840', 840)).toEqual({ ok: true, amount: 840 }));
  test('less is refused', () => expect(validateCodCollection('839', 840).ok).toBe(false));
  test('more is refused', () => expect(validateCodCollection('841', 840).ok).toBe(false));
  test('paise are refused', () => expect(validateCodCollection('839.50', 840).ok).toBe(false));
  test('empty is refused', () => expect(validateCodCollection('', 840).ok).toBe(false));
  test('non-numeric is refused', () => expect(validateCodCollection('8a0', 840).ok).toBe(false));
  test('unknown due amount blocks completion', () => expect(validateCodCollection('840', null).ok).toBe(false));
  test('whitespace is trimmed', () => expect(validateCodCollection(' 840 ', 840).ok).toBe(true));
});

describe('codReportLimitPaise mirrors the web finance panel', () => {
  test('collection: max(expected, due) when due rounds up', () => expect(codReportLimitPaise({ status: 'expected', expectedPaise: 83950, duePaise: 84000 })).toBe(84000));
  test('collection: max(expected, due) when due rounds down', () => expect(codReportLimitPaise({ status: 'expected', expectedPaise: 83920, duePaise: 83900 })).toBe(83920));
  test('collection without duePaise derives it', () => expect(codReportLimitPaise({ status: 'expected', expectedPaise: 83950 })).toBe(84000));
  test('handover: what was collected', () => expect(codReportLimitPaise({ status: 'collected', expectedPaise: 83920, collectedPaise: 83900 })).toBe(83900));
});

describe('rupeesToPaise', () => {
  test.each([['839.2', 83920], ['839.20', 83920], ['0.01', 1], ['1', 100], ['1.005', null], ['-1', null], ['abc', null], ['', null]])('%s -> %s', (input, out) => {
    expect(rupeesToPaise(input)).toBe(out);
  });
});

describe('formatting', () => {
  test('whole rupees have no decimals', () => expect(formatRupees(840)).toBe('₹840'));
  test('fractional rupees show two decimals', () => expect(formatRupees(839.2)).toBe('₹839.20'));
  test('missing is a dash, never ₹0', () => { expect(formatRupees(undefined)).toBe('—'); expect(formatRupees(null)).toBe('—'); expect(formatRupees('x')).toBe('—'); });
  test('paise always two decimals', () => expect(formatPaise(83920)).toBe('₹839.20'));
});
