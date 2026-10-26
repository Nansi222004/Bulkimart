import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';

let vite, Onboarding, StatusGate, validation, Provider, drafts, requests;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Onboarding = (await vite.ssrLoadModule('/src/modules/Seller/pages/OnboardingPage.jsx')).default;
  StatusGate = (await vite.ssrLoadModule('/src/modules/Seller/components/SellerStatusGate.jsx')).default;
  validation = await vite.ssrLoadModule('/src/modules/Seller/utils/onboardingValidation.js');
  Provider = (await vite.ssrLoadModule('/src/modules/Seller/context/SellerContext.jsx')).SellerProvider;
  drafts = await vite.ssrLoadModule('/src/modules/Seller/utils/onboardingDraft.js');
  requests = await vite.ssrLoadModule('/src/utils/portalRequests.js');
});
after(async () => vite?.close());

const text = node => node == null ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' ');
const fixture = (step, overrides = {}) => ({
  onboardingStep: step, selectedTypes: ['ecommerce', 'quick'], aadhaarNo: '123456789012',
  userProfile: { phone: '9876543210' },
  bizForm: { storeName: 'Test Store', description: 'Complete store description', category: 'Groceries', pickupEmail: 'seller@example.test' },
  addressForm: { street: '123 Test Street', landmark: 'Near Test Square', district: 'Indore', state: 'Madhya Pradesh', pincode: '452001', lat: 22.72, lng: 75.86 },
  bankForm: { holderName: 'Test Seller', bankName: 'HDFC Bank', accountNumber: '001234567890', ifscCode: 'HDFC0001234' },
  uploadedDocs: { aadhaarFront: { name: 'front.pdf' }, aadhaarBack: { name: 'back.pdf' }, passbook: { name: 'cheque.pdf' } },
  panNumber: 'ABCPV1234K', gstDecision: { choice: 'without_gstin' }, ...overrides,
});

test('all bank fields reject blank and malformed values and retain leading account zeroes', () => {
  const { sellerBankErrors } = validation;
  assert.deepEqual(Object.keys(sellerBankErrors({})), ['holderName', 'bankName', 'accountNumber', 'ifscCode']);
  for (const accountNumber of ['123', '12345678', '1234567890123456789', '12345678x', '1234 567890']) {
    assert.ok(sellerBankErrors({ ...fixture(6).bankForm, accountNumber }).accountNumber);
  }
  for (const ifscCode of ['HDFC1001234', '12340001234', 'HDFC000123', 'hdfc0001234']) {
    assert.ok(sellerBankErrors({ ...fixture(6).bankForm, ifscCode }).ifscCode);
  }
  assert.ok(sellerBankErrors({ ...fixture(6).bankForm, holderName: '1234' }).holderName);
  assert.ok(sellerBankErrors({ ...fixture(6).bankForm, bankName: '!!!' }).bankName);
  assert.deepEqual(sellerBankErrors(fixture(6).bankForm), {});
  assert.deepEqual(sellerBankErrors({ ...fixture(6).bankForm, holderName: 'सीमा शर्मा' }), {});
  assert.deepEqual(sellerBankErrors({ ...fixture(6).bankForm, holderName: 'M/S Test & Sons 24' }), {});
});

test('bank errors render on the bank page, clear after correction and allow Continue', () => {
  const steps = [], context = fixture(6, { bankForm: {}, setOnboardingStep: step => steps.push(step) });
  const h = hookHarness(Onboarding, {}, '/seller', context);
  try {
    h.click('Continue');
    assert.deepEqual(steps, []);
    for (const message of ['Account holder name is required', 'Bank name is required', '9–18 digits', '11-character IFSC']) assert.ok(text(h.tree).includes(message));
    assert.equal(h.find(n => n.type === 'input' && n.props.placeholder === 'Account Number').props['aria-invalid'], true);
    context.bankForm = fixture(6).bankForm; h.rerender();
    assert.equal(h.find(n => n.props?.role === 'alert'), undefined);
    h.click('Continue'); assert.deepEqual(steps, [7]);
  } finally { h.close(); }
});

test('IFSC is uppercased while editing and invalid values validate on blur', () => {
  let updated;
  const context = fixture(6, { bankForm: { ...fixture(6).bankForm, ifscCode: '' }, setBankForm: value => { updated = value; } });
  const h = hookHarness(Onboarding, {}, '/seller', context);
  try {
    const input = h.find(n => n.type === 'input' && n.props.placeholder === 'e.g. HDFC0001234');
    input.props.onBlur(); h.flush(); assert.match(text(h.tree), /11-character IFSC/);
    input.props.onChange({ target: { value: 'hdfc0001234' } }); assert.equal(updated.ifscCode, 'HDFC0001234');
  } finally { h.close(); }
});

test('KYC validates each mandatory upload, PAN format and each GST choice before review', () => {
  const valid = fixture(7);
  assert.deepEqual(validation.sellerStepIssues(7, valid), []);
  for (const key of ['aadhaarFront', 'aadhaarBack', 'passbook']) {
    assert.ok(validation.sellerStepIssues(7, { ...valid, uploadedDocs: { ...valid.uploadedDocs, [key]: null } }).length);
  }
  assert.ok(validation.sellerStepIssues(7, { ...valid, panNumber: 'ABCDEFGHIJ' }).length);
  for (const gstDecision of [{}, { choice: 'no_gstin' }, { choice: 'has_gstin', gstin: 'invalid' }, { choice: 'assistance', contactName: 'Contact', consent: false }]) {
    assert.ok(validation.sellerStepIssues(7, { ...valid, gstDecision }).length);
  }
  assert.deepEqual(validation.sellerStepIssues(7, { ...valid, gstDecision: { choice: 'has_gstin', gstin: '29ABCDE1234F1Z5' } }), []);
});

test('invalid PAN blocks review on KYC page; correcting it permits review without optional scans', () => {
  const steps = [], context = fixture(7, { panNumber: 'ABCDEFGHIJ', setOnboardingStep: step => steps.push(step) });
  const h = hookHarness(Onboarding, {}, '/seller', context);
  try {
    h.click('Continue to Review'); assert.deepEqual(steps, []); assert.match(text(h.tree), /valid 10-character PAN/);
    context.panNumber = 'ABCPV1234K'; h.rerender();
    h.click('Continue to Review'); assert.deepEqual(steps, [8]);
  } finally { h.close(); }
});

test('address and business errors appear before leaving their respective pages', () => {
  for (const [step, overrides, message] of [
    [4, { bizForm: { storeName: '  ' } }, /Store name is required/],
    [5, { addressForm: { street: 'Test', pincode: 'abc' } }, /6-digit pincode/],
    [5, { bizForm: { pickupEmail: 'invalid' } }, /valid pickup contact email/],
    [5, { addressForm: { lat: null, lng: null } }, /street address or pin/],
  ]) {
    const steps = [], h = hookHarness(Onboarding, {}, '/seller', fixture(step, { ...overrides, setOnboardingStep: value => steps.push(value) }));
    try { h.click('Continue'); assert.deepEqual(steps, []); assert.match(text(h.tree), message); } finally { h.close(); }
  }
  assert.deepEqual(validation.sellerStepIssues(5, { addressForm: { street: 'Test Street', pincode: '452001' }, userProfile: { email: 'saved@example.test' } }), []);
  assert.deepEqual(validation.sellerStepIssues(5, { addressForm: { lat: 22.72, lng: 75.86 }, bizForm: { pickupEmail: 'store@example.test' } }), []);
});

test('review displays entered registration details, all filenames and GST assistance details', () => {
  const context = fixture(8, { gstDecision: { choice: 'assistance', contactName: 'GST Contact', message: 'Help with registration', consent: true } });
  const h = hookHarness(Onboarding, {}, '/seller', context);
  try {
    const summary = text(h.tree);
    for (const value of ['Test Store', 'Complete store description', 'Hybrid', '9876543210', '123 Test Street', 'Near Test Square', 'Indore', 'Madhya Pradesh', '452001', 'seller@example.test', '22.72, 75.86', 'HDFC Bank', 'Test Seller', '001234567890', 'HDFC0001234', 'XXXX-XXXX-9012', 'ABCPV1234K', 'front.pdf', 'back.pdf', 'cheque.pdf', 'Not uploaded', 'GST Contact', 'Help with registration', 'Accepted']) assert.ok(summary.includes(value), `Missing ${value}`);
    assert.ok(!summary.includes('123456789012'));
  } finally { h.close(); }
});

test('missing details stay on review with an explicit Edit action instead of restarting a completed step', async () => {
  let submitted = 0;
  const steps = [], context = fixture(8, { bankForm: {}, setOnboardingStep: value => steps.push(value), submitSellerApplication: async () => { submitted++; return { ok: true }; } });
  const h = hookHarness(Onboarding, {}, '/seller', context);
  try {
    h.find(n => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: true } }); h.flush();
    const submit = h.find(n => n.type === 'button' && n.props.children === 'Submit for Verification');
    assert.equal(submit.props.disabled, true);
    await submit.props.onClick(); assert.deepEqual(steps, []); assert.equal(submitted, 0);
    assert.match(text(h.tree), /Bank name is required/);
    h.click('Edit bank details'); assert.deepEqual(steps, [6]);
  } finally { h.close(); }
});

test('missing Aadhaar never causes an automatic jump from review', async () => {
  const steps = [], h = hookHarness(Onboarding, {}, '/seller', fixture(8, { aadhaarNo: '', setOnboardingStep: step => steps.push(step) }));
  try {
    await h.click('Submit for Verification');
    assert.deepEqual(steps, []);
    assert.match(text(h.tree), /Review & Submit Summary/);
    assert.match(text(h.tree), /12-digit Aadhaar/);
    h.click('Edit identity details'); assert.deepEqual(steps, [3]);
  } finally { h.close(); }
});

const storage = initial => {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
};
const accountStorage = id => storage({ sellerToken: 'onboarding-fixture', sellerUserProfile: JSON.stringify({ _id: id, phone: '9876543210' }) });
async function mountSeller(local) {
  requests.clearPortalRequests('seller');
  const h = hookHarness(props => { window.localStorage = local; return Provider(props); }, {}, '/seller', undefined, { localStorage: local });
  h.requests.find(request => request.url.endsWith('/api/sellers/me')).resolve({ success: true, seller: null });
  await h.settle();
  return h;
}
function completeRegistration(h) {
  const value = h.tree.props.value, complete = fixture(8);
  value.setAadhaarNo(complete.aadhaarNo); value.setAadhaarVerified(true);
  value.setBizForm(complete.bizForm); value.setAddressForm(complete.addressForm); value.setBankForm(complete.bankForm);
  value.setPanNumber(complete.panNumber); value.setGstDecision(complete.gstDecision);
  const file = new File(['Synthetic KYC fixture'], 'front.pdf', { type: 'application/pdf' });
  value.setUploadedDocs({ aadhaarFront: file, aadhaarBack: file, passbook: file, pan: null, businessCert: null });
  value.setOnboardingStep(8); h.flush();
  return file;
}

test('completed Aadhaar, bank fields and real uploads survive same-account remounts without browser storage', async () => {
  const local = accountStorage('same-session-seller'), key = drafts.getSellerDraftKey('same-session-seller');
  let h = await mountSeller(local);
  try {
    const file = completeRegistration(h);
    h.close(); local.setItem('sellerToken', 'renewed-onboarding-fixture'); h = await mountSeller(local);
    const value = h.tree.props.value;
    assert.equal(value.onboardingStep, 8); assert.equal(value.aadhaarNo, fixture(8).aadhaarNo); assert.equal(value.aadhaarVerified, true);
    assert.deepEqual(value.bankForm, fixture(8).bankForm); assert.equal(value.uploadedDocs.aadhaarFront, file);
    for (const [field, expected] of Object.entries(fixture(8).addressForm)) assert.equal(value.addressForm[field], expected);
    assert.equal(value.panNumber, fixture(8).panNumber);
    const saved = local.getItem(key);
    for (const secret of [fixture(8).aadhaarNo, fixture(8).bankForm.accountNumber, fixture(8).panNumber, file.name]) assert.ok(!saved.includes(secret));
  } finally { h.close(); drafts.clearSellerDraft(local, key); }
});

test('a stored page number cannot reopen review without the in-memory registration fields', async () => {
  const local = accountStorage('stored-progress-seller'), key = drafts.getSellerDraftKey('stored-progress-seller');
  drafts.writeSellerDraft(local, key, { step: 8, selectedTypes: ['ecommerce'], bizForm: fixture(8).bizForm });
  const h = await mountSeller(local);
  try { assert.equal(h.tree.props.value.onboardingStep, 3); assert.equal(h.tree.props.value.aadhaarNo, ''); }
  finally { h.close(); drafts.clearSellerDraft(local, key); }
});

test('account changes clear the prior seller identity, documents and in-memory registration', async () => {
  const local = accountStorage('first-draft-seller'), key = drafts.getSellerDraftKey('first-draft-seller');
  const h = await mountSeller(local);
  try {
    completeRegistration(h);
    h.tree.props.value.setUserProfile({ _id: 'second-draft-seller', phone: '9876543211' }); h.flush();
    assert.equal(h.tree.props.value.aadhaarNo, ''); assert.equal(h.tree.props.value.aadhaarVerified, false);
    assert.equal(h.tree.props.value.uploadedDocs.aadhaarFront, null); assert.equal(drafts.readSellerSessionDraft(key), null);
  } finally { h.close(); drafts.clearSellerDraft(local, key); drafts.clearSellerDraft(local, drafts.getSellerDraftKey('second-draft-seller')); }
});

test('the provider submits restored identity and uploads without navigating backwards, then clears the draft', async () => {
  const local = accountStorage('submitted-draft-seller'), key = drafts.getSellerDraftKey('submitted-draft-seller');
  let h = await mountSeller(local);
  try {
    completeRegistration(h); h.close(); h = await mountSeller(local);
    const pending = h.tree.props.value.submitSellerApplication();
    for (const path of ['/api/sellers/start', '/api/sellers/step/1', '/api/sellers/step/2', '/api/sellers/step/3', '/api/sellers/step/4', '/api/sellers/submit']) {
      const request = h.requests.find(request => request.url.endsWith(path));
      assert.ok(request, `Missing request ${path}`);
      if (path.endsWith('/step/2')) assert.equal(request.options.body.get('aadhaarNumber'), fixture(8).aadhaarNo);
      request.resolve({ success: true, seller: { _id: 'submitted-seller', status: 'pending' } }); await h.settle();
      assert.equal(h.tree.props.value.onboardingStep, 8);
    }
    assert.equal((await pending).ok, true); h.flush();
    assert.equal(drafts.readSellerSessionDraft(key), null); assert.equal(local.getItem(key), null);
  } finally { h.close(); drafts.clearSellerDraft(local, key); }
});

test('valid application keeps the existing submission and completion flow', async () => {
  let submitted = 0, completed = 0;
  const steps = [], context = fixture(8, { setOnboardingStep: value => steps.push(value), submitSellerApplication: async () => { submitted++; return { ok: true }; } });
  const h = hookHarness(Onboarding, { onSubmitted: () => { completed++; } }, '/seller', context);
  try {
    h.find(n => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: true } }); h.flush();
    await h.click('Submit for Verification'); assert.equal(submitted, 1); assert.equal(completed, 1); assert.deepEqual(steps, [9]);
  } finally { h.close(); }
});

test('application under review says Back to login and retains the existing sign-out callback', () => {
  let exited = 0;
  const h = hookHarness(StatusGate, { status: 'pending', onExit: () => { exited++; } });
  try { assert.doesNotMatch(text(h.tree), /Back to shopping/); h.click('Back to login'); assert.equal(exited, 1); } finally { h.close(); }
});
