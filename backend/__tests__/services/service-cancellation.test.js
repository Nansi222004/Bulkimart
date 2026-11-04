import { applicantCancellation } from '../../services/serviceWorkflow.service.js';
import { serviceFeeQuote } from '../../services/servicePayment.service.js';

const paidAt = new Date('2026-11-04T10:00:00Z');
const paid = (extra = {}, bill = {}) => ({ status: 'submitted', billing: { status: 'paid', paidAt, cancellationWindowHours: 24, ...bill }, ...extra });

describe('service fee from admin settings', () => {
  test.each([[2000, 18, 236000], [999, 18, 117882], [6999, 18, 825882], [999, 0, 99900], [999, 12.5, 112388]])('₹%d at %d%% GST → %d paise', (amount, taxRate, total) => {
    expect(serviceFeeQuote({ pricing: { mode: 'fixed', amount, currency: 'INR', taxRate } }).amountPaise).toBe(total);
  });
  test('older services without a rate charge no GST; free services have no fee', () => {
    expect(serviceFeeQuote({ pricing: { mode: 'fixed', amount: 100, currency: 'INR' } })).toMatchObject({ taxPaise: 0, amountPaise: 10000 });
    expect(serviceFeeQuote({ pricing: { mode: 'free', amount: 0, currency: 'INR' } })).toBeNull();
  });
});

describe('applicant cancellation of a fixed-price request', () => {
  test('within the window and before work starts: cancel with a wallet refund', () => {
    expect(applicantCancellation(paid(), new Date('2026-11-05T09:59:00Z'))).toMatchObject({ allowed: true, refund: true });
  });
  test('after the window: refused', () => {
    expect(applicantCancellation(paid(), new Date('2026-11-05T10:01:00Z'))).toMatchObject({ allowed: false, refund: false });
  });
  test('once work has started: refused even inside the window', () => {
    expect(applicantCancellation(paid({ status: 'in_progress', processingAt: new Date('2026-11-04T11:00:00Z') }), new Date('2026-11-04T12:00:00Z'))).toMatchObject({ allowed: false });
  });
  test('a 0-hour window means no cancellation after payment', () => {
    expect(applicantCancellation(paid({}, { cancellationWindowHours: 0 }), new Date('2026-11-04T10:05:00Z'))).toMatchObject({ allowed: false });
  });
  test('unpaid requests can be cancelled with nothing to refund; a payment in progress cannot', () => {
    expect(applicantCancellation({ status: 'awaiting_payment', billing: { status: 'unpaid' } })).toMatchObject({ allowed: true, refund: false });
    expect(applicantCancellation({ status: 'awaiting_payment', billing: { status: 'pending' } })).toMatchObject({ allowed: false });
  });
  test('closed or finance-review requests cannot be cancelled; an interrupted refund can be resumed', () => {
    expect(applicantCancellation(paid({ status: 'rejected' }))).toMatchObject({ allowed: false });
    expect(applicantCancellation(paid({}, { reviewRequired: true }), new Date('2026-11-04T11:00:00Z'))).toMatchObject({ allowed: false });
    expect(applicantCancellation(paid({ status: 'cancelled' }, { cancelRefundDue: true }))).toMatchObject({ allowed: true, refund: true, resume: true });
  });
});
