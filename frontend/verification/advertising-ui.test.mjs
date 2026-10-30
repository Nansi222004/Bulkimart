import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';
let vite, Workspace, helpers, navigation, Billing, PackageForm, Builder;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Workspace = (await vite.ssrLoadModule('/src/components/advertising/AdvertisingWorkspace.jsx')).default;
  helpers = await vite.ssrLoadModule('/src/components/advertising/advertisingApi.js');
  navigation = (await vite.ssrLoadModule('/src/components/advertising/useAdvertisingNavigation.js')).useAdvertisingNavigation;
  Billing = (await vite.ssrLoadModule('/src/components/advertising/AdvertisingBillingPanel.jsx')).default;
  PackageForm = (await vite.ssrLoadModule('/src/components/advertising/AdvertisingPackageForm.jsx')).default;
  Builder = (await vite.ssrLoadModule('/src/components/advertising/CampaignBuilder.jsx')).default;
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
    assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Approve campaign').props.disabled, true);
    h.find(n => n.type === 'textarea').props.onChange({ target: { value: 'Verified eligibility' } }); h.flush();
    h.click('Approve campaign'); const sent = h.requests[3];
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
test('Create campaign opens the multi-category builder; the builder loads seller products and packages', async () => {
  const h = hookHarness(Workspace);
  try {
    h.requests[0].resolve(capabilities()); await h.settle(); h.requests[1].resolve(list([])); await h.settle();
    h.click('Create campaign'); assert.ok(h.find(n => n.type === Builder), 'The builder is shown'); assert.equal(h.requests.length, 2);
  } finally { h.close(); }
  const b = hookHarness(Builder, { onClose() {}, onOpen() {} });
  try {
    assert.match(b.requests[0].url, /advertising\/products\?module=ECOMMERCE&limit=20&page=1$/);
    assert.match(b.requests[1].url, /advertising\/packages/);
    b.requests[0].resolve(list([{ id:'p', name:'Owned product', sku:'SKU', eligible:true, reason:'', categories:[{id:'c',name:'Category'}], adCategories:[{id:'c',name:'Category',parentName:''}], variants:[{id:'v',name:'Small',price:14,stock:3}] }]));
    b.requests[1].resolve(list([])); await b.settle(); assert.match(text(b.tree), /Owned product/);
    assert.equal(b.find(n => n.type === 'button' && n.props.children === 'Continue').props.disabled, true);
  } finally { b.close(); }
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
  assert.equal(helpers.campaignLabel(campaign({ delivery:'CANCELLED', funding:'REFUNDED' })), 'REFUNDED');
  assert.equal(helpers.campaignLabel(campaign({ delivery:'CANCELLED', funding:'PARTIALLY_REFUNDED' })), 'PARTIALLY REFUNDED');
  assert.equal(helpers.campaignStatusClass(campaign({ delivery:'CANCELLED', funding:'REFUNDED' })), 'refunded');
  assert.equal(helpers.campaignStatusClass(campaign({ delivery:'CANCELLED', funding:'PARTIALLY_REFUNDED' })), 'partially_refunded');
});
test('cancelled advertising with refunded amount displays refunded status and badge in admin panel', async () => {
  const h = hookHarness(Workspace, { admin: true });
  try {
    h.requests[0].resolve(capabilities(['advertising_review', 'advertising_finance'])); await h.settle();
    h.requests[1].resolve(list([campaign({ name: 'Summer Campaign', delivery: 'CANCELLED', funding: 'REFUNDED', review: 'APPROVED' })])); await h.settle();
    assert.match(text(h.tree), /Summer Campaign/);
    assert.match(text(h.tree), /REFUNDED/);
    const pill = h.find(n => n.type === 'span' && typeof n.props.className === 'string' && n.props.className.includes('ad-status-pill'));
    assert.ok(pill);
    assert.equal(pill.props.className, 'ad-status-pill ad-status-refunded');
    assert.equal(text(pill), 'REFUNDED');
    h.click('View campaign');
    h.requests[2].resolve({ success: true, data: campaign({ name: 'Summer Campaign', delivery: 'CANCELLED', funding: 'REFUNDED', review: 'APPROVED' }) }); await h.settle();
    assert.match(text(h.tree), /Payment:\s+Refunded/);
    assert.match(text(h.tree), /Ad:\s+Cancelled/);
    assert.match(text(h.tree), /Not showing:\s+cancelled and refunded\./);
  } finally { h.close(); }
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
    h.find(n=>n.type==='textarea').props.onChange({target:{value:'Synthetic review approval'}});h.flush();h.click('Approve campaign');
    h.requests.at(-1).resolve({success:true,data:campaign({review:'APPROVED',version:5})});await h.settle();
    const after=h.find(n=>n.type===Billing);assert.equal(after.key,'campaign-id:5');assert.notEqual(after.key,before.key);
  }finally{h.close();}
});
test('editing a campaign: the category step offers only categories every ticked product belongs to, and picks a single one', async () => {
  const h = hookHarness(Workspace);
  const next = () => { h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); h.flush(); };
  try {
    const draft = campaign({ review: 'DRAFT', categoryId: '', items: [] });
    h.requests[0].resolve(capabilities()); await h.settle(); h.requests[1].resolve(list([draft])); await h.settle();
    h.click('View campaign'); h.requests[2].resolve({ success: true, data: draft }); await h.settle();
    h.click('Edit campaign');
    h.requests[3].resolve(list([
      { id: 'dress', name: 'Different clothing', eligible: true, reason: '', categories: [{ id: 'clothing', name: 'Clothing' }], variants: [{ id: 'v1', name: 'M', price: 500, stock: 3 }] },
      { id: 'buds', name: 'Wireless buds', eligible: true, reason: '', categories: [{ id: 'earbuds', name: 'Earbuds' }], variants: [{ id: 'v2', name: 'Black', price: 900, stock: 2 }] },
    ]));
    h.requests[4].resolve(list([])); await h.settle();
    const tick = productName => { const item = h.find(n => n.type === 'div' && /ad-product-item/.test(n.props.className || '') && text(n).includes(productName)); h.find(n => n.type === 'input' && n.props.type === 'checkbox', item).props.onChange({ target: { checked: true } }); h.flush(); };
    const categorySelect = () => h.find(n => n.type === 'select' && [n.props.children].flat(Infinity).some(o => o?.props?.value === '' && /category/i.test(text(o))));
    tick('Different clothing'); next();
    let options = [categorySelect().props.children].flat(Infinity).filter(o => o?.props?.value).map(o => o.props.value);
    assert.deepEqual(options, ['clothing'], 'Earbuds is not offered for a clothing product');
    assert.equal(categorySelect().props.value, 'clothing', 'The only fitting category is chosen');
    h.click('Back'); h.flush(); tick('Wireless buds'); next();
    options = [categorySelect().props.children].flat(Infinity).filter(o => o?.props?.value).map(o => o.props.value);
    assert.deepEqual(options, []); assert.match(text(h.tree), /different categories/);
  } finally { h.close(); }
});

for (const admin of [true,false]) test((admin?'admin':'seller')+' campaign notification opens its authenticated detail and handles another notification',async()=>{
 const id='507f1f77bcf86cd799439011', next='507f1f77bcf86cd799439012';
 const h=hookHarness(Workspace,{admin},'/'+(admin?'admin':'seller')+'/advertising?campaign='+id);
 try {
  h.requests[0].resolve(capabilities(admin?['advertising_review']:[]));await h.settle();
  const detail=h.requests.find(r=>r.url.endsWith('/campaigns/'+id));assert.ok(detail);
  detail.resolve({success:true,data:campaign({id})});await h.settle();
  assert.equal(h.find(n=>n.props?.['aria-label']==='Close details').props.children,'✕');
  const helper=await vite.ssrLoadModule('/src/components/advertising/advertisingNotifications.js');
  const tabs=[];helper.openAdvertisingNotification({route:'/'+(admin?'admin':'seller')+'/advertising?campaign='+next,metadata:{campaignId:next}},tab=>tabs.push(tab),admin);
  await h.settle();assert.deepEqual(tabs,['advertising']);assert.ok(h.requests.some(r=>r.url.endsWith('/campaigns/'+next)));
  assert.equal(helper.openAdvertisingNotification({route:'https://evil.example/?campaign='+id},()=>assert.fail('external navigation'),admin),false);
 }finally{h.close();}
});

test('approved campaign exposes a versioned payment reminder without finance permission or a new payment attempt',async()=>{
 const h=hookHarness(Workspace,{admin:true});
 try{
  const cap=capabilities(['advertising_review']);cap.data.paymentsEnabled=true;h.requests[0].resolve(cap);await h.settle();
  h.requests[1].resolve(list([campaign()]));await h.settle();h.click('View campaign');
  h.requests[2].resolve({success:true,data:campaign({review:'APPROVED',paid:{authorized:true}})});await h.settle();
  h.click('Send payment reminder');const sent=h.requests[3];assert.match(sent.url,/request-payment$/);assert.deepEqual(JSON.parse(sent.options.body),{version:4});
  sent.resolve({success:true});await h.settle();assert.match(text(h.tree),/Payment reminder sent/);
  assert.equal(h.requests.some(r=>r.url.includes('payment-attempts')),false);
 }finally{h.close();}
});
test('admins see which seller sent a campaign on its card and in its detail, also after a decision', async () => {
  const seller = { id: 'seller-id', storeName: 'Sharma Store', businessName: 'Sharma Traders Pvt Ltd', city: 'Indore' };
  const h = hookHarness(Workspace, { admin: true });
  try {
    h.requests[0].resolve(capabilities(['advertising_review'])); await h.settle();
    h.requests[1].resolve(list([campaign({ seller })])); await h.settle();
    assert.match(text(h.tree), /Seller:\s+Sharma Store\s+· Indore/);
    h.click('View campaign'); h.requests[2].resolve({ success: true, data: campaign({ seller }) }); await h.settle();
    assert.match(text(h.tree), /Sharma Store\s*\(Sharma Traders Pvt Ltd\)\s*· Indore/);
    h.find(n => n.type === 'textarea').props.onChange({ target: { value: 'Verified eligibility' } }); h.flush();
    h.click('Approve campaign');
    h.requests[3].resolve({ success: true, data: campaign({ review: 'APPROVED', version: 5 }) }); await h.settle();
    assert.match(text(h.tree), /APPROVED AWAITING PAYMENT/); assert.match(text(h.tree), /Sharma Store\s*\(Sharma Traders Pvt Ltd\)/);
  } finally { h.close(); }
  const own = hookHarness(Workspace, {});
  try {
    own.requests[0].resolve(capabilities([])); await own.settle();
    own.requests.at(-1).resolve(list([campaign()])); await own.settle();
    assert.doesNotMatch(text(own.tree), /Seller:/);
  } finally { own.close(); }
});

test('editing a campaign: products per ad stops ticking at the package limit, only fitting packages are offered, no past start', async () => {
  const h = hookHarness(Workspace);
  const next = () => { h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); h.flush(); };
  const pack = (id, maxProducts) => ({ id, name: `Pack ${id}`, module: 'ECOMMERCE', isActive: true, archivedAt: null, categories: [], durationDays: 7, maxProducts, amountPaise: 10000 });
  const product = id => ({ id, name: `Product ${id}`, eligible: true, reason: '', categories: [{ id: 'clothing', name: 'Clothing' }], variants: [{ id: `v-${id}`, name: 'M', price: 500, stock: 3 }] });
  try {
    const draft = campaign({ review: 'DRAFT', categoryId: 'clothing', packageId: 'two', items: [{ productId: 'a', variantId: 'v-a' }] });
    h.requests[0].resolve(capabilities()); await h.settle(); h.requests[1].resolve(list([draft])); await h.settle();
    h.click('View campaign'); h.requests[2].resolve({ success: true, data: draft }); await h.settle();
    h.click('Edit campaign');
    h.requests[3].resolve(list(['a', 'b', 'c'].map(product)));
    h.requests[4].resolve(list([pack('one', 1), pack('two', 2)])); await h.settle();
    const box = name => h.find(n => n.type === 'input' && n.props.type === 'checkbox', h.find(n => n.type === 'div' && /ad-product-item/.test(n.props.className || '') && text(n).includes(name)));
    box('Product b').props.onChange({ target: { checked: true } }); h.flush();
    assert.match(text(h.tree), /Products per ad: up to\s+2\s*\.\s+Picked\s+2/);
    assert.equal(box('Product c').props.disabled, true, 'A third product cannot be ticked');
    assert.equal(box('Product a').props.disabled, false, 'A ticked product can still be unticked');
    next(); next();
    const packages = [h.find(n => n.type === 'select' && [n.props.children].flat(Infinity).some(o => o?.props?.value === '' && /package/i.test(text(o)))).props.children].flat(Infinity).filter(o => o?.props?.value).map(o => o.props.value);
    assert.deepEqual(packages, ['two'], 'The one-product package is not offered for two products');
    assert.match(text(h.tree), /fewer than\s+2\s+products per ad/);
    const start = h.find(n => n.type === 'input' && n.props.type === 'datetime-local');
    assert.match(start.props.min, /^\d{4}-\d\d-\d\dT\d\d:\d\d$/); assert.ok(new Date(start.props.min) >= new Date(Date.now() - 60000), 'No past date or time can be picked');
  } finally { h.close(); }
});
test('Submit for review is hidden while the terms are open and after the campaign is submitted', async () => {
  const h = hookHarness(Workspace);
  try {
    h.requests[0].resolve(capabilities()); await h.settle(); h.requests[1].resolve(list([campaign({ review: 'DRAFT', funding: 'UNPAID', delivery: 'NOT_SCHEDULED' })])); await h.settle();
    h.click('View campaign'); h.requests.at(-1).resolve({ success: true, data: campaign({ review: 'DRAFT', funding: 'UNPAID', delivery: 'NOT_SCHEDULED' }) }); await h.settle();
    const submitButton = () => h.find(n => n.type === 'button' && [n.props.children].flat(Infinity).join('').trim() === 'Submit for review');
    assert.ok(submitButton()); h.click('Submit for review');
    h.requests.at(-1).resolve({ success: true, data: { id: 'pkg', name: 'Pack', version: 1, durationDays: 7, amountPaise: 10000, policies: {} } }); await h.settle();
    assert.equal(submitButton(), undefined, 'Only "Confirm terms and submit" remains');
    h.click('Confirm terms and submit');
    h.requests.find(r => /\/submit$/.test(r.url)).resolve({ success: true, data: campaign({ review: 'PENDING_REVIEW', funding: 'UNPAID', delivery: 'NOT_SCHEDULED', version: 5 }) }); await h.settle();
    assert.equal(submitButton(), undefined); assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Confirm terms and submit'), undefined);
  } finally { h.close(); }
});

// Multi-category builder (one storefront per wizard; one normal campaign per category group).
const cat = (id, name, parentId = null, parentName = '') => ({ id, name, parentId, parentName });
const CLOTHING = cat('clothing', 'Clothing');
const shopProducts = () => [
  { id: 'shirt', name: "Men's Shirt", eligible: true, reason: '', categories: [CLOTHING], adCategories: [cat('mens', "Men's Wear", 'clothing', 'Clothing'), CLOTHING], variants: [{ id: 'v-shirt', name: 'M', price: 500, stock: 3 }] },
  { id: 'kurta', name: "Women's Kurta", eligible: true, reason: '', categories: [CLOTHING], adCategories: [cat('womens', "Women's Wear", 'clothing', 'Clothing'), CLOTHING], variants: [{ id: 'v-kurta', name: 'L', price: 700, stock: 2 }] },
  { id: 'buds', name: 'Wireless Earbuds', eligible: true, reason: '', categories: [cat('electronics', 'Electronics')], adCategories: [cat('electronics', 'Electronics')], variants: [{ id: 'v-buds', name: 'Black', price: 900, stock: 4 }] },
  { id: 'storage', name: 'Kitchen Storage Set', eligible: true, reason: '', categories: [cat('kitchen', 'Home & Kitchen')], adCategories: [cat('kitchen', 'Home & Kitchen')], variants: [{ id: 'v-storage', name: 'Set', price: 300, stock: 5 }] },
];
const offer = (id, maxProducts, categories = [], extra = {}) => ({ id, name: `Pack ${id}`, module: 'ECOMMERCE', isActive: true, archivedAt: null, categories, durationDays: 7, maxProducts, amountPaise: 10000,
  billingQuote: { basePaise: 10000, taxPaise: 1800, totalPaise: 11800 }, version: 3, policies: {}, ...extra });
const groupsLib = () => vite.ssrLoadModule('/src/components/advertising/campaignGroups.js');
function builder(products = shopProducts(), packages = [offer('two', 2), offer('one', 1), offer('elec', 1, ['electronics'])]) {
  const h = hookHarness(Builder, { onClose() {}, onOpen() {} });
  h.requests[0].resolve(list(products)); h.requests[1].resolve(list(packages));
  const tick = name => { const item = h.find(n => n.type === 'div' && /ad-product-item/.test(n.props.className || '') && text(n).includes(name)); h.find(n => n.type === 'input' && n.props.type === 'checkbox', item).props.onChange({ target: { checked: true } }); h.flush(); };
  const section = label => h.find(n => n.type === 'section' && n.props['aria-label'] === label);
  const choose = (label, value) => { h.find(n => n.type === 'select', section(label)).props.onChange({ target: { value } }); h.flush(); };
  const field = (title, value, within) => { const l = h.find(n => n.type === 'label' && [n.props.children].flat(Infinity).some(c => c?.props?.className === 'ad-field-title' && text(c).trim() === title), within); h.find(n => n.type === 'input' || n.type === 'select', l).props.onChange({ target: { value } }); h.flush(); };
  const button = label => h.find(n => n.type === 'button' && [n.props.children].flat(Infinity).join('') === label);
  const dates = within => { const found = []; const walk = node => { if (!node || typeof node !== 'object') return; if (node.type === 'input' && node.props.type === 'datetime-local') found.push(node); [node.props?.children].flat(Infinity).forEach(walk); }; walk(within || h.tree); return found; };
  return { h, tick, section, choose, field, button, dates };
}

test('builder: products from several categories form one group each; a parent category merges groups; products and groups can be removed', async () => {
  const { h, tick, section, choose, field, button } = builder();
  try {
    await h.settle(); field('Campaign name', 'Diwali Sale');
    for (const name of ["Men's Shirt", "Women's Kurta", 'Wireless Earbuds', 'Kitchen Storage Set']) tick(name);
    assert.match(text(h.tree), /Picked\s+4 products\s+in\s+4 categories/);
    h.click('Continue');
    for (const label of ["Men's Wear", "Women's Wear", 'Electronics', 'Home & Kitchen']) assert.ok(section(`Group ${label}`), `${label} is its own group`);
    assert.match(text(h.tree), /Diwali Sale – Men's Wear/);
    // Only categories every product in the group allows are offered (most specific first).
    assert.deepEqual([h.find(n => n.type === 'select', section("Group Men's Wear")).props.children].flat(Infinity).map(o => o.props.value), ['mens', 'clothing']);
    assert.deepEqual([h.find(n => n.type === 'select', section('Group Electronics')).props.children].flat(Infinity).map(o => o.props.value), ['electronics']);
    choose("Group Men's Wear", 'clothing'); choose("Group Women's Wear", 'clothing');
    assert.equal(section("Group Men's Wear"), undefined); assert.equal(section("Group Women's Wear"), undefined);
    assert.match(text(section('Group Clothing')), /Men's Shirt[\s\S]*Women's Kurta/, 'Both clothing products are merged under Clothing');
    h.click('Undo category changes'); assert.ok(section("Group Men's Wear"), 'Undo splits the merged group again');
    h.find(n => n.type === 'button' && n.props.children === 'Remove group', section('Group Home & Kitchen')).props.onClick(); h.flush();
    assert.equal(section('Group Home & Kitchen'), undefined);
    h.find(n => n.type === 'button' && n.props['aria-label'] === 'Remove Wireless Earbuds').props.onClick(); h.flush();
    assert.equal(section('Group Electronics'), undefined, 'An emptied group disappears');
    for (const label of ["Group Men's Wear", "Group Women's Wear"]) { h.find(n => n.type === 'button' && n.props.children === 'Remove group', section(label)).props.onClick(); h.flush(); }
    assert.match(text(h.tree), /No products are left/); assert.equal(button('Continue').props.disabled, true);
  } finally { h.close(); }
});

test('builder: packages per group fit storefront, category and products per ad; shared and individual start dates; consolidated review', async () => {
  const { localInput } = await groupsLib();
  const { h, tick, section, choose, field, button, dates } = builder();
  try {
    await h.settle(); field('Campaign name', 'Diwali Sale');
    for (const name of ["Men's Shirt", "Women's Kurta", 'Wireless Earbuds']) tick(name);
    h.click('Continue'); choose("Group Men's Wear", 'clothing'); choose("Group Women's Wear", 'clothing'); h.click('Continue');
    const options = label => [h.find(n => n.type === 'select', section(label)).props.children].flat(Infinity).filter(o => o?.props?.value).map(o => o.props.value);
    assert.deepEqual(options('Campaign Diwali Sale – Clothing'), ['two'], 'Two products: one-product packages and the Electronics-only package are not offered');
    assert.deepEqual(options('Campaign Diwali Sale – Electronics'), ['two', 'one', 'elec']);
    assert.equal(button('Continue').props.disabled, true, 'No package or date yet');
    choose('Campaign Diwali Sale – Clothing', 'two'); choose('Campaign Diwali Sale – Electronics', 'elec');
    assert.equal(button('Continue').props.disabled, true, 'No start date yet');
    const past = localInput(new Date(Date.now() - 3600000)), later = localInput(new Date(Date.now() + 7200000)), other = localInput(new Date(Date.now() + 86400000));
    assert.equal(dates().length, 1, 'One shared date by default');
    assert.ok(new Date(dates()[0].props.min) >= new Date(Date.now() - 60000), 'No past date can be picked');
    dates()[0].props.onChange({ target: { value: past } }); h.flush();
    assert.equal(button('Continue').props.disabled, true, 'A past start is refused');
    assert.match(text(h.tree), /from now onwards/);
    dates()[0].props.onChange({ target: { value: later } }); h.flush();
    assert.equal(button('Continue').props.disabled, false);
    // Separate dates: the shared date is copied to each campaign, then one is changed.
    h.find(n => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: false } }); h.flush();
    const [electronicsDate] = dates(section('Campaign Diwali Sale – Electronics'));
    assert.equal(electronicsDate.props.value, later); electronicsDate.props.onChange({ target: { value: other } }); h.flush();
    assert.equal(dates(section('Campaign Diwali Sale – Clothing'))[0].props.value, later);
    assert.equal(dates(section('Campaign Diwali Sale – Electronics'))[0].props.value, other);
    h.click('Continue');
    const summary = text(h.tree);
    assert.match(summary, /Diwali Sale – Clothing[\s\S]*Shop All\s+·\s+Clothing\s+·\s+2 products[\s\S]*Men's Shirt[\s\S]*Women's Kurta[\s\S]*Pack two\s+·\s+7\s+days · up to\s+2 products\s+per ad ·\s+₹100\.00[\s\S]*₹18\.00 GST = ₹118\.00/);
    assert.match(summary, /Diwali Sale – Electronics[\s\S]*Pack elec/);
    assert.match(summary, /Total for\s+2 campaigns\s*:\s+₹236\.00[\s\S]*includes ₹36\.00 GST/);
    assert.match(summary, /Each campaign is reviewed and paid separately\. You pay only for campaigns approved by Bulkimart\./);
    assert.equal(h.requests.length, 2, 'Nothing is saved or paid before the seller saves');
  } finally { h.close(); }
});

test('builder: saves one normal campaign per group, keeps saved ones on a partial failure, retries without duplicates, then submits all with confirmed terms', async () => {
  const { localInput } = await groupsLib();
  const { h, tick, section, choose, field, dates } = builder();
  try {
    await h.settle(); field('Campaign name', 'Diwali Sale');
    for (const name of ["Men's Shirt", 'Wireless Earbuds']) tick(name);
    h.click('Continue'); h.click('Continue');
    choose("Campaign Diwali Sale – Men's Wear", 'two'); choose('Campaign Diwali Sale – Electronics', 'elec');
    const start = localInput(new Date(Date.now() + 7200000));
    dates()[0].props.onChange({ target: { value: start } }); h.flush();
    h.click('Continue'); h.click('Save 2 campaigns');
    const first = h.requests[2], firstBody = JSON.parse(first.options.body);
    assert.match(first.url, /\/sellers\/advertising\/campaigns$/); assert.equal(first.options.method, 'POST');
    assert.deepEqual({ ...firstBody, requestKey: undefined, requestedStartAt: undefined }, { name: "Diwali Sale – Men's Wear", module: 'ECOMMERCE', categoryId: 'mens', items: [{ productId: 'shirt', variantId: 'v-shirt' }], packageId: 'two', requestKey: undefined, requestedStartAt: undefined });
    assert.equal(firstBody.requestedStartAt, new Date(start).toISOString()); assert.match(firstBody.requestKey, /^[a-zA-Z0-9-]{16,100}$/);
    first.resolve({ success: true, data: campaign({ id: 'c-mens', name: "Diwali Sale – Men's Wear", review: 'DRAFT', version: 0, packageId: 'two' }) }); await h.settle();
    const second = h.requests[3], secondBody = JSON.parse(second.options.body);
    assert.equal(secondBody.categoryId, 'electronics'); assert.notEqual(secondBody.requestKey, firstBody.requestKey);
    second.resolve({ message: 'Selected product is unavailable or not owned by this seller' }, 409); await h.settle();
    assert.match(text(h.tree), /1 of\s+2 campaigns\s+saved\.\s+1 campaign\s+could not be saved/); assert.doesNotMatch(text(h.tree), /All\s+2 campaigns/);
    assert.match(text(section("Result Diwali Sale – Men's Wear")), /Draft saved/);
    assert.match(text(section('Result Diwali Sale – Electronics')), /Not saved[\s\S]*Selected product is unavailable/);
    h.find(n => n.type === 'button' && n.props.children === 'Retry', section('Result Diwali Sale – Electronics')).props.onClick(); h.flush();
    assert.equal(h.requests.length, 5, 'Only the failed campaign is sent again');
    assert.equal(JSON.parse(h.requests[4].options.body).requestKey, secondBody.requestKey, 'A retry reuses its key, so the server cannot create a duplicate');
    h.requests[4].resolve({ success: true, data: campaign({ id: 'c-elec', name: 'Diwali Sale – Electronics', review: 'DRAFT', version: 0, packageId: 'elec' }) }); await h.settle();
    assert.match(text(h.tree), /All\s+2 campaigns\s+are saved as drafts/);
    h.click('Submit all for review');
    const terms = h.requests.slice(5); assert.deepEqual(terms.map(r => r.url.replace(/.*advertising/, '')).sort(), ['/packages/elec', '/packages/two']);
    terms.forEach(r => r.resolve({ success: true, data: offer(r.url.split('/').pop(), 2, [], { version: r.url.endsWith('two') ? 5 : 6, policies: { cancellation: 'Synthetic cancellation terms' } }) })); await h.settle();
    assert.match(text(h.tree), /Synthetic cancellation terms/);
    h.click('Confirm terms and submit 2 campaigns');
    const submitMens = h.requests[7]; assert.match(submitMens.url, /campaigns\/c-mens\/submit$/); assert.deepEqual(JSON.parse(submitMens.options.body), { version: 0, packageVersion: 5 });
    submitMens.resolve({ message: 'Campaign changed; refresh before continuing' }, 409); await h.settle();
    const submitElec = h.requests[8]; assert.deepEqual(JSON.parse(submitElec.options.body), { version: 0, packageVersion: 6 });
    submitElec.resolve({ success: true, data: campaign({ id: 'c-elec', review: 'PENDING_REVIEW', version: 1, packageId: 'elec' }) }); await h.settle();
    assert.match(text(section('Result Diwali Sale – Electronics')), /Waiting for review/);
    assert.match(text(section("Result Diwali Sale – Men's Wear")), /Campaign changed/);
    h.find(n => n.type === 'button' && n.props.children === 'Retry submit', section("Result Diwali Sale – Men's Wear")).props.onClick(); h.flush();
    assert.equal(h.requests.length, 10); assert.match(h.requests[9].url, /c-mens\/submit$/, 'Only the failed submission is retried');
    h.requests[9].resolve({ success: true, data: campaign({ id: 'c-mens', review: 'PENDING_REVIEW', version: 1, packageId: 'two' }) }); await h.settle();
    assert.match(text(section("Result Diwali Sale – Men's Wear")), /Waiting for review/);
    assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Submit all for review'), undefined);
    assert.equal(h.requests.some(r => /payment/.test(r.url)), false, 'No payment is started by saving or submitting');
  } finally { h.close(); }
});

test('builder: problems block progress — no package for a category, too many products for every package', async () => {
  const { h, tick, section, field, button } = builder(shopProducts(), [offer('one', 1, ['mens'])]);
  try {
    await h.settle(); field('Campaign name', 'Diwali Sale');
    for (const name of ["Men's Shirt", "Women's Kurta", 'Wireless Earbuds']) tick(name);
    h.click('Continue');
    for (const label of ["Group Men's Wear", "Group Women's Wear"]) { h.find(n => n.type === 'select', section(label)).props.onChange({ target: { value: 'clothing' } }); h.flush(); }
    h.click('Continue');
    assert.match(text(section('Campaign Diwali Sale – Electronics')), /No advertising package is available for this category\./);
    assert.match(text(section('Campaign Diwali Sale – Clothing')), /No advertising package is available for this category\./, "A Men's Wear package does not cover the Clothing campaign");
    assert.equal(button('Continue').props.disabled, true);
  } finally { h.close(); }
  const tight = builder(shopProducts(), [offer('one', 1)]);
  try {
    await tight.h.settle(); tight.field('Campaign name', 'Diwali Sale'); tight.tick("Men's Shirt"); tight.tick("Women's Kurta");
    tight.h.click('Continue');
    for (const label of ["Group Men's Wear", "Group Women's Wear"]) { tight.h.find(n => n.type === 'select', tight.section(label)).props.onChange({ target: { value: 'clothing' } }); tight.h.flush(); }
    tight.h.click('Continue');
    assert.match(text(tight.section('Campaign Diwali Sale – Clothing')), /allow up to\s+1 product\s+per ad\. Remove\s+1 product\s+from this group\./);
    assert.equal(tight.button('Continue').props.disabled, true, 'Products are never dropped silently');
  } finally { tight.h.close(); }
});

test('builder: one storefront per wizard — switching asks first and clears the selection; search and category filter go to the server', async () => {
  const { h, tick, field } = builder();
  try {
    await h.settle(); tick("Men's Shirt");
    field('Storefront', 'QUICK');
    assert.match(text(h.tree), /Switching to\s+Quick Commerce\s+clears the\s+1 product\s+you picked in\s+Shop All/);
    assert.equal(h.requests.length, 2, 'Nothing changes until the seller confirms');
    h.click('Keep Shop All'); assert.doesNotMatch(text(h.tree), /Switching to/); assert.match(text(h.tree), /Picked\s+1 product/);
    field('Storefront', 'QUICK'); h.click('Switch and clear');
    assert.match(h.requests.at(-1).url, /products\?module=QUICK&limit=20&page=1$/);
    h.requests.at(-1).resolve(list([])); await h.settle();
    assert.doesNotMatch(text(h.tree), /Picked/);
    field('Search products', 'kurta'); await new Promise(resolve => setTimeout(resolve, 350)); await h.settle();
    assert.match(h.requests.at(-1).url, /module=QUICK&limit=20&page=1&q=kurta$/);
  } finally { h.close(); }
  const filter = builder();
  try {
    await filter.h.settle();
    filter.field('Category filter', 'mens');
    assert.match(filter.h.requests.at(-1).url, /module=ECOMMERCE&limit=20&page=1&category=mens$/);
  } finally { filter.h.close(); }
});

test('campaign grouping helpers: names stay within the server limit, same-named categories show their parent, packages follow the server category rule', async () => {
  const { campaignGroups, campaignName, packagesFor } = await groupsLib();
  assert.ok(campaignName('x'.repeat(300), 'Electronics').length <= 200); assert.match(campaignName('x'.repeat(300), 'Electronics'), / – Electronics$/);
  const product = (id, c) => ({ product: { id, adCategories: [c] }, variantId: `v-${id}` });
  const groups = campaignGroups([product('a', cat('men-shoes', 'Men', 'footwear', 'Footwear')), product('b', cat('men-wear', 'Men', 'clothing', 'Clothing'))]);
  assert.deepEqual(groups.map(g => g.label), ['Footwear › Men', 'Clothing › Men']);
  const { inCategory, fitting } = packagesFor([offer('all', 1), offer('parent', 5, ['clothing']), offer('quick', 5, [], { module: 'QUICK' })], 'ECOMMERCE', { categoryId: 'men-wear', items: [1, 2] });
  assert.deepEqual(inCategory.map(p => p.id), ['all']); assert.deepEqual(fitting, []);
});

test('campaign cards and details name the storefront, category and products; the admin keeps them after a decision', async () => {
  const named = extra => campaign({ module: 'ECOMMERCE', category: { id: 'mens', name: "Men's Wear", parentName: 'Clothing' },
    products: [{ id: 'shirt', name: "Men's Shirt", variant: 'M' }, { id: 'tee', name: 'Plain Tee', variant: 'Standard' }],
    terms: { name: 'Pack two', amountPaise: 10000, durationDays: 7, maxProducts: 2 }, seller: { id: 's', storeName: 'Sharma Store', businessName: '', city: '' }, ...extra });
  const h = hookHarness(Workspace, { admin: true });
  try {
    h.requests[0].resolve(capabilities(['advertising_review'])); await h.settle();
    h.requests[1].resolve(list([named()])); await h.settle();
    assert.match(text(h.tree), /Shop All\s+·\s+Clothing › Men's Wear/);
    h.click('View campaign'); h.requests[2].resolve({ success: true, data: named() }); await h.settle();
    const detail = text(h.tree);
    assert.match(detail, /Storefront and category\s+Shop All\s+·\s+Clothing › Men's Wear/);
    assert.match(detail, /Products \(\s*2\s*\)\s+Men's Shirt \(M\), Plain Tee/);
    assert.match(detail, /Pack two\s*:\s+₹100\.00\s+for\s+7\s+days · up to\s+2 products\s+per ad/);
    h.find(n => n.type === 'textarea').props.onChange({ target: { value: 'Needs a better picture' } }); h.flush();
    h.click('Request changes');
    h.requests[3].resolve({ success: true, data: campaign({ review: 'CHANGES_REQUESTED', version: 5, terms: { name: 'Pack two', amountPaise: 10000, durationDays: 7, maxProducts: 2 } }) }); await h.settle();
    assert.match(text(h.tree), /Clothing › Men's Wear/); assert.match(text(h.tree), /Men's Shirt \(M\)/); assert.match(text(h.tree), /Sharma Store/);
  } finally { h.close(); }
});

test('builder: a package without GST says so instead of adding ₹0.00 GST; a package without billing terms does not invent GST', async () => {
  const { localInput } = await groupsLib();
  for (const [quote, expected] of [[{ basePaise: 10000, taxPaise: 0, totalPaise: 10000 }, /₹100\.00\s+· no GST/], [undefined, /₹100\.00\s+\(GST not set in this package\)/]]) {
    const { h, tick, choose, field, dates } = builder(shopProducts(), [offer('plain', 2, [], { billingQuote: quote })]);
    try {
      await h.settle(); field('Campaign name', 'Diwali Sale'); tick('Wireless Earbuds');
      h.click('Continue'); h.click('Continue'); choose('Campaign Diwali Sale – Electronics', 'plain');
      dates()[0].props.onChange({ target: { value: localInput(new Date(Date.now() + 7200000)) } }); h.flush(); h.click('Continue');
      assert.match(text(h.tree), expected); assert.doesNotMatch(text(h.tree), /₹0\.00 GST/);
    } finally { h.close(); }
  }
});

test('editing an older package without saved GST and refund terms says so; a package with them does not', async () => {
  const row = { id: 'pkg-old', version: 2, name: 'Starter Quick Spotlight', module: 'QUICK', amountPaise: 29900, durationDays: 7, maxProducts: 5, categories: [], isActive: true, policies: {} };
  const old = hookHarness(PackageForm, { value: helpers.packageFormFromRow(row), busy: false, onCancel() {}, onSave() {} });
  try { assert.match(text(old.tree), /no GST and refund terms saved yet, so sellers cannot pay for it/); } finally { old.close(); }
  const saved = { ...row, policies: { billing: { taxTreatment: 'EXCLUSIVE', taxRateBps: 1800 } } };
  const current = hookHarness(PackageForm, { value: helpers.packageFormFromRow(saved), busy: false, onCancel() {}, onSave() {} });
  try { assert.doesNotMatch(text(current.tree), /no GST and refund terms saved yet/); } finally { current.close(); }
  const fresh = hookHarness(PackageForm, { value: helpers.blankPackageForm(), busy: false, onCancel() {}, onSave() {} });
  try { assert.doesNotMatch(text(fresh.tree), /no GST and refund terms saved yet/, 'A new package is not warned about'); } finally { fresh.close(); }
});

test('the campaign detail says where and when the ad shows, in plain words', async () => {
  const day = 86400000, category = { id: 'travel', name: 'Travel items', parentName: 'Bags' };
  const cases = [
    [{ review: 'PENDING_REVIEW' }, /Not showing yet: it starts after Bulkimart approves it and the seller pays\./],
    [{ review: 'APPROVED', requestedStartAt: new Date(Date.now() + day).toISOString(), terms: { name: 'P', durationDays: 7, amountPaise: 100 } }, /Starts once the seller pays: on .+, or on the payment date if that is later, for 7 days\./],
    [{ review: 'APPROVED', funding: 'FUNDED', delivery: 'SCHEDULED', paid: { startAt: new Date(Date.now() + day).toISOString(), endAt: new Date(Date.now() + 8 * day).toISOString() } }, /Starts .+ and runs until .+\./],
    [{ review: 'APPROVED', funding: 'FUNDED', delivery: 'ACTIVE', paid: { startAt: new Date(Date.now() - day).toISOString(), endAt: new Date(Date.now() + day).toISOString() } }, /Showing now, until .+\./],
    [{ review: 'APPROVED', funding: 'FUNDED', delivery: 'COMPLETED', paid: { startAt: new Date(Date.now() - 9 * day).toISOString(), endAt: new Date(Date.now() - day).toISOString() } }, /Not showing: finished\./],
  ];
  for (const [state, timing] of cases) {
    const row = campaign({ module: 'QUICK', category, ...state });
    const h = hookHarness(Workspace);
    try {
      h.requests[0].resolve(capabilities()); await h.settle(); h.requests[1].resolve(list([row])); await h.settle();
      h.click('View campaign'); h.requests[2].resolve({ success: true, data: row }); await h.settle();
      const detail = text(h.tree);
      assert.match(detail, /Where and when it shows\s+In the “Sponsored” row at the top of the “Travel items” category page and the “Bags” page in Quick Commerce, for shoppers the seller delivers to\./);
      assert.match(detail, timing, `${state.delivery || state.review}`);
    } finally { h.close(); }
  }
});

test('builder Step 0: products per ad stops ticking at package limit in same category and shows notice', async () => {
  const p1 = { id: 'p1', name: 'Shirt A', eligible: true, reason: '', categories: [{ id: 'mens', name: "Men's Wear" }], variants: [{ id: 'v1', name: 'M', price: 500, stock: 3 }] };
  const p2 = { id: 'p2', name: 'Shirt B', eligible: true, reason: '', categories: [{ id: 'mens', name: "Men's Wear" }], variants: [{ id: 'v2', name: 'L', price: 500, stock: 3 }] };
  const p3 = { id: 'p3', name: 'Shirt C', eligible: true, reason: '', categories: [{ id: 'mens', name: "Men's Wear" }], variants: [{ id: 'v3', name: 'XL', price: 500, stock: 3 }] };
  const packTwo = offer('pack-two', 2, ['mens']);
  const { h, tick } = builder([p1, p2, p3], [packTwo]);
  try {
    await h.settle();
    tick('Shirt A');
    tick('Shirt B');
    assert.match(text(h.tree), /Picked\s+2 products/);
    const boxC = h.find(n => n.type === 'input' && n.props.type === 'checkbox', h.find(n => n.type === 'div' && /ad-product-item/.test(n.props.className || '') && text(n).includes('Shirt C')));
    assert.equal(boxC.props.disabled, true, 'A third product in the same category cannot be ticked when max is 2');
    assert.match(text(h.tree), /Limit reached: max\s+2\s+per ad/);
  } finally { h.close(); }
});

