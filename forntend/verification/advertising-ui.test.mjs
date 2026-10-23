import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';
let vite, Workspace, helpers, navigation, Billing;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Workspace = (await vite.ssrLoadModule('/src/components/advertising/AdvertisingWorkspace.jsx')).default;
  helpers = await vite.ssrLoadModule('/src/components/advertising/advertisingApi.js');
  navigation = (await vite.ssrLoadModule('/src/components/advertising/useAdvertisingNavigation.js')).useAdvertisingNavigation;
  Billing = (await vite.ssrLoadModule('/src/components/advertising/AdvertisingBillingPanel.jsx')).default;
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
    assert.match(text(h.tree), /currently disabled/);
  } finally { h.close(); }
});
test('disabled capability prevents campaign and package requests', async () => {
  const h = hookHarness(Workspace);
  try {
    h.requests[0].resolve({ success: true, data: { managementEnabled: false } }); await h.settle();
    assert.equal(h.requests.length, 1); assert.match(text(h.tree), /currently disabled/);
    assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Create campaign'), undefined);
  } finally { h.close(); }
});
test('seller list is backend driven and pagination and filters go to the server', async () => {
  const h = hookHarness(Workspace);
  try {
    h.requests[0].resolve(capabilities()); await h.settle();
    assert.match(h.requests[1].url, /sellers\/advertising\/campaigns\?page=1&limit=20/);
    h.requests[1].resolve(list([campaign()])); await h.settle();
    assert.match(text(h.tree), /Actual backend campaign/); assert.match(text(h.tree), /ROAS: pending/);
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
test('package configuration uses dynamic durations and leaves attribution unconfigured', async () => {
  const h = hookHarness(Workspace, { admin: true });
  try {
    h.requests[0].resolve(capabilities(['advertising_configure'])); await h.settle();
    h.requests[1].resolve(list([])); await h.settle(); h.click('Create package');
    assert.match(text(h.tree), /Attribution window/); assert.match(text(h.tree), /policy drafts/);
    assert.equal(h.find(n => n.type === 'input' && n.props.type === 'number' && n.props.value === '').props.value, '');
    const p = helpers.packagePayload({ name:'Configured', description:'Text', module:'QUICK', price:'97.43', durationDays:'11', maxProducts:'3', categories:'', isActive:false, archived:false, reason:'Approved draft', policies:{}, windowHours:'' });
    assert.equal(p.durationDays, 11); assert.equal(p.amountPaise, 9743); assert.equal(p.policies.attribution, undefined);
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
    h.click('Review submission terms'); h.requests[3].resolve({success:true,data:{id:'pkg',name:'Confirmed terms',version:7,amountPaise:13579,durationDays:11,policies:{}}}); await h.settle();
    assert.match(text(h.tree), /Confirm\s+Confirmed terms\s*, version\s+7/);
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
