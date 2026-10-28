import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';
let vite, Workspace, helpers, navigation, Billing, PackageForm;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Workspace = (await vite.ssrLoadModule('/src/components/advertising/AdvertisingWorkspace.jsx')).default;
  helpers = await vite.ssrLoadModule('/src/components/advertising/advertisingApi.js');
  navigation = (await vite.ssrLoadModule('/src/components/advertising/useAdvertisingNavigation.js')).useAdvertisingNavigation;
  Billing = (await vite.ssrLoadModule('/src/components/advertising/AdvertisingBillingPanel.jsx')).default;
  PackageForm = (await vite.ssrLoadModule('/src/components/advertising/AdvertisingPackageForm.jsx')).default;
});
after(async () => vite.close());
const text = n => n == null ? '' : typeof n !== 'object' ? String(n) : [n.props?.children].flat(Infinity).map(text).join(' ');
const capabilities = (permissions = []) => ({ success: true, data: { managementEnabled: true, paymentsEnabled: false, deliveryEnabled: false, permissions } });
const campaign = extra => ({ id: 'campaign-id', name: 'Actual backend campaign', module: 'ECOMMERCE', version: 4, revision: 2,
  review: 'PENDING_REVIEW', delivery: 'NOT_SCHEDULED', funding: 'UNPAID', history: [], items: [], ...extra });
const list = data => ({ success: true, data, meta: { page: 1, pages: 2, total: 21 } });
test('navigation remains hidden until server capability enables management', async () => {
  const h = hookHarness(() => navigation() ? 'enabled' : 'disabled');
  try {
    assert.equal(h.tree, 'disabled');
    h.requests[0].resolve(capabilities()); await h.settle(); assert.equal(h.tree, 'enabled');
  } finally { h.close(); }
});
test('capability failures offer a working retry without trusting a local enable flag', async () => {
  const h = hookHarness(Workspace);
  try {
    h.requests[0].resolve({message:'Temporarily unavailable'},503); await h.settle();
    assert.match(text(h.tree), /Temporarily unavailable/);
    h.click('Retry'); assert.match(h.requests[1].url, /capabilities$/);
    h.requests[1].resolve({success:true,data:{managementEnabled:false}}); await h.settle();
    assert.match(text(h.tree), /not available right now/);
  } finally { h.close(); }
});
test('disabled capability prevents campaign and package requests', async () => {
  const h = hookHarness(Workspace);
  try {
    h.requests[0].resolve({ success: true, data: { managementEnabled: false } }); await h.settle();
    assert.equal(h.requests.length, 1); assert.match(text(h.tree), /not available right now/);
    assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Create campaign'), undefined);
  } finally { h.close(); }
});
test('seller list is backend driven and pagination and filters go to the server', async () => {
  const h = hookHarness(Workspace);
  try {
    h.requests[0].resolve(capabilities()); await h.settle();
    assert.match(h.requests[1].url, /sellers\/advertising\/campaigns\?page=1&limit=20/);
    h.requests[1].resolve(list([campaign()])); await h.settle();
    assert.match(text(h.tree), /Actual backend campaign/); assert.doesNotMatch(text(h.tree), /ROAS|Compliance|Seller Growth Suite/);
    h.click('Next'); assert.match(h.requests[2].url, /page=2/);
    h.find(n => n.type === 'select').props.onChange({ target: { value: 'APPROVED' } }); h.flush();
    assert.match(h.requests[3].url, /page=1&limit=20&review=APPROVED/);
    h.requests[2].resolve(list([campaign({ name: 'STALE RESULT' })])); await h.settle(); assert.doesNotMatch(text(h.tree), /STALE RESULT/);
  } finally { h.close(); }
});
test('review-only admin has review controls without package configuration', async () => {
  const h = hookHarness(Workspace, { admin: true });
  try {
    h.requests[0].resolve(capabilities(['advertising_review'])); await h.settle();
    h.requests[1].resolve(list([campaign()])); await h.settle();
    assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Packages and policies'), undefined);
    h.click('View campaign'); h.requests[2].resolve({ success: true, data: campaign() }); await h.settle();
    assert.equal(h.find(n => n.type === 'button' && n.props.children === 'approve').props.disabled, true);
    h.find(n => n.type === 'textarea').props.onChange({ target: { value: 'Verified eligibility' } }); h.flush();
    h.click('approve'); const sent = h.requests[3];
    assert.match(sent.url, /admin\/advertising\/campaigns\/campaign-id\/approve/);
    assert.deepEqual(JSON.parse(sent.options.body), { version: 4, reason: 'Verified eligibility' });
    sent.resolve({ success: true, data: campaign({ review: 'APPROVED', version: 5 }) }); await h.settle();
    assert.match(text(h.tree), /APPROVED AWAITING PAYMENT/);
  } finally { h.close(); }
});
test('the package form asks only for admin decisions; billing, refunds and tracking are filled in', async () => {
  const h = hookHarness(Workspace, { admin: true });
  try {
    h.requests[0].resolve(capabilities(['advertising_configure'])); await h.settle();
    h.requests[1].resolve(list([])); await h.settle(); h.click('Create package');
    const form = h.find(n => n.type === PackageForm); assert.ok(form, 'Create package opens the simple form');
    assert.equal(form.props.value.gst, 'EXCLUSIVE'); assert.equal(form.props.value.allCategories, true);
  } finally { h.close(); }
  const p = helpers.packagePayload({ ...helpers.blankPackageForm(), name: ' Configured ', module: 'QUICK', price: '97.43', durationDays: '11', maxProducts: '3' });
  assert.equal(p.name, 'Configured'); assert.equal(p.amountPaise, 9743); assert.equal(p.durationDays, 11); assert.equal(p.maxProducts, 3);
  assert.deepEqual(p.categories, []); assert.equal(p.reason, 'Package created by admin');
  assert.equal(p.policies.billing.taxTreatment, 'EXCLUSIVE'); assert.equal(p.policies.billing.taxRateBps, 1800);
  assert.deepEqual(p.policies.billing.refunds, { cancellationBps: 10000, suspensionBps: 10000, unavailableBps: 10000, unusedBps: 10000 });
  assert.deepEqual(p.policies.attribution, { windowHours: 24, conversionEvent: 'PAID', model: 'LAST_CLICK' });
  assert.match(p.policies.tax.treatment, /18% GST is added/); assert.ok(p.policies.cancellation);
  assert.deepEqual(helpers.packageCharge(99900, 'EXCLUSIVE', '18'), { basePaise: 99900, taxPaise: 17982, totalPaise: 117882 });
  assert.deepEqual(helpers.packageCharge(118000, 'INCLUSIVE', '18'), { basePaise: 100000, taxPaise: 18000, totalPaise: 118000 });
  assert.equal(helpers.packagePayload({ ...helpers.blankPackageForm(), name: 'N', price: '10', gst: 'NONE' }).policies.billing.taxRateBps, 0);
  // Editing keeps the package's own terms and categories, and drops empty saved sections the server would reject.
  const edited = helpers.packagePayload(helpers.packageFormFromRow({ id: 'pkg', version: 2, name: 'Old', module: 'ECOMMERCE', amountPaise: 50000, durationDays: 7, maxProducts: 5,
    categories: ['cat-1'], isActive: true, policies: { tax: {}, attribution: {}, cancellation: 'Custom cancellation', billing: { issuer: 'Legal name', taxTreatment: 'INCLUSIVE', taxRateBps: 500, refunds: { cancellationBps: 5000, suspensionBps: 5000, unavailableBps: 5000, unusedBps: 5000 } } } }));
  assert.deepEqual(edited.categories, ['cat-1']); assert.equal(edited.version, 2); assert.equal(edited.reason, 'Package updated by admin');
  assert.equal(edited.policies.cancellation, 'Custom cancellation'); assert.equal(edited.policies.billing.issuer, 'Legal name');
  assert.equal(edited.policies.billing.taxTreatment, 'INCLUSIVE'); assert.equal(edited.policies.billing.taxRateBps, 500); assert.equal(edited.policies.billing.refunds.unusedBps, 5000);
  assert.deepEqual(edited.policies.attribution, { windowHours: 24, conversionEvent: 'PAID', model: 'LAST_CLICK' });
});
test('categories are picked by name, and a package cannot be saved with an empty category choice', async () => {
  const saved = [], h = hookHarness(PackageForm, { value: helpers.blankPackageForm(), onSave: f => saved.push(f), onCancel() {} });
  try {
    h.requests[0].resolve([{ _id: 'parent', name: 'Fashion', parent: null, isActive: true }, { _id: 'child', name: 'Shoes', parent: 'parent', isActive: true }, { _id: 'off', name: 'Retired', isActive: false }]); await h.settle();
    assert.doesNotMatch(text(h.tree), /Shoes/, 'All categories is the default');
    h.click('Choose categories');
    assert.match(text(h.tree), /Fashion › Shoes/); assert.doesNotMatch(text(h.tree), /Retired/);
    assert.equal(h.find(n => n.type === 'button' && n.props.className === 'ad-primary').props.disabled, true);
    h.find(n => n.type === 'input' && n.props.type === 'checkbox' && !n.props.disabled && text(h.find(m => m.type === 'label' && [m.props.children].flat().includes(n))) .includes('Shoes')).props.onChange({ target: { checked: true } }); h.flush();
    assert.equal(h.find(n => n.type === 'button' && n.props.className === 'ad-primary').props.disabled, false);
    h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
    assert.deepEqual(saved[0].categories, ['child']); assert.equal(saved[0].allCategories, false);
  } finally { h.close(); }
});
test('wizard loads seller-owned product catalogue and configured packages', async () => {
  const h = hookHarness(Workspace);
  try {
    h.requests[0].resolve(capabilities()); await h.settle(); h.requests[1].resolve(list([])); await h.settle();
    h.click('Create campaign');
    assert.match(h.requests[2].url, /advertising\/products\?module=ECOMMERCE/);
    assert.match(h.requests[3].url, /advertising\/packages/);
    h.requests[2].resolve(list([{ id:'p', name:'Owned product', sku:'SKU', eligible:true, reason:'', categories:[{id:'c',name:'Category'}], variants:[{id:'v',name:'Small',price:14,stock:3}] }]));
    h.requests[3].resolve(list([])); await h.settle(); assert.match(text(h.tree), /Owned product/);
    assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Continue').props.disabled, true);
  } finally { h.close(); }
});
test('submission sends the explicitly confirmed package version', async () => {
  const h = hookHarness(Workspace);
  try {
    h.requests[0].resolve(capabilities()); await h.settle(); h.requests[1].resolve(list([campaign({review:'DRAFT'})])); await h.settle();
    h.click('View campaign'); h.requests[2].resolve({success:true,data:campaign({review:'DRAFT',packageId:'pkg'})}); await h.settle();
    h.click('Submit for review'); h.requests[3].resolve({success:true,data:{id:'pkg',name:'Confirmed terms',version:7,amountPaise:13579,durationDays:11,policies:{}}}); await h.settle();
    // The seller sees the package and its price; the version they saw is still what gets submitted.
    assert.match(text(h.tree), /Confirmed terms/); assert.match(text(h.tree), /₹135\.79\s+for\s+11\s+days/);
    h.click('Confirm terms and submit');
    assert.deepEqual(JSON.parse(h.requests.at(-1).options.body), {version:4,packageVersion:7});
    h.requests.at(-1).resolve({success:true,data:campaign({version:5})}); await h.settle();
  } finally { h.close(); }
});
test('formatters do not fabricate unconfigured amounts or mislabel approval as active', () => {
  assert.equal(helpers.advertisingMoney(undefined), 'Not configured');
  assert.equal(helpers.campaignLabel(campaign({ review:'APPROVED' })), 'APPROVED AWAITING PAYMENT');
  assert.equal(helpers.campaignLabel(campaign({ delivery:'ADMIN_SUSPENDED' })), 'ADMIN SUSPENDED');
});
test('admin pilot authorization uses versioned explicit dates and never claims funding', async () => {
  const h = hookHarness(Workspace, {admin:true});
  try {
    h.requests[0].resolve({success:true,data:{...capabilities(['advertising_review']).data,pilotEnabled:true}});await h.settle();
    h.requests[1].resolve(list([campaign({review:'APPROVED'})]));await h.settle();h.click('View campaign');
    h.requests[2].resolve({success:true,data:campaign({review:'APPROVED'})});await h.settle();
    assert.match(text(h.tree),/Non-billable category pilot/);
    h.find(n=>n.type==='textarea').props.onChange({target:{value:'Explicit pilot authorization'}});h.flush();
    const dateInputs=[];const walk=n=>{if(!n||typeof n!=='object')return;if(n.type==='input'&&n.props.type==='datetime-local')dateInputs.push(n);for(const child of [n.props?.children].flat(Infinity))walk(child);};walk(h.tree);
    dateInputs[0].props.onChange({target:{value:'2027-01-01T10:00'}});dateInputs[1].props.onChange({target:{value:'2027-01-02T10:00'}});h.flush();
    h.click('Authorize non-billable pilot');const sent=h.requests.at(-1);assert.match(sent.url,/campaign-id\/pilot$/);
    const body=JSON.parse(sent.options.body);assert.equal(body.enabled,true);assert.equal(body.version,4);assert.match(body.startAt,/Z$/);assert.equal(body.funding,undefined);
    sent.resolve({success:true,data:campaign({review:'APPROVED',version:5,pilot:{enabled:true,startAt:body.startAt,endAt:body.endAt}})});await h.settle();
    assert.match(text(h.tree),/not paid or funded service/);
  } finally {h.close();}
});

test('moderation refreshes the billing panel for the new campaign version',async()=>{
  const h=hookHarness(Workspace,{admin:true});
  try{
    h.requests[0].resolve(capabilities(['advertising_review','advertising_finance']));await h.settle();
    h.requests[1].resolve(list([campaign()]));await h.settle();h.click('View campaign');
    h.requests[2].resolve({success:true,data:campaign()});await h.settle();
    const before=h.find(n=>n.type===Billing);assert.equal(before.key,'campaign-id:4');
    h.find(n=>n.type==='textarea').props.onChange({target:{value:'Synthetic review approval'}});h.flush();h.click('approve');
    h.requests.at(-1).resolve({success:true,data:campaign({review:'APPROVED',version:5})});await h.settle();
    const after=h.find(n=>n.type===Billing);assert.equal(after.key,'campaign-id:5');assert.notEqual(after.key,before.key);
  }finally{h.close();}
});
