import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';
let vite, Center, Commission, Rates, Charges, Shiprocket, simulate, Sidebar, Overview, Policy;
before(async()=>{
  vite=await createServer({server:{middlewareMode:true},appType:'custom'});
  const load=async file=>(await vite.ssrLoadModule('/src/modules/Admin/components/'+file+'.jsx'));
  Center=(await load('FinanceCenter')).default; Commission=(await load('FinanceWorkflowTab')).default;
  const rates=await load('DeliveryRatesTab'); Rates=rates.RateCard; Charges=rates.CustomerDeliveryChargeCard;
  Shiprocket=(await load('QuickThirdPartySettingsTab')).default; simulate=(await load('CommissionSimulation')).simulateCommission;
  Sidebar=(await load('LeftSidebar')).default;
  Overview=(await load('FinanceOverview')).default; Policy=(await load('FinancePolicySettings')).default;
});
after(async()=>vite.close());
const text=h=>JSON.stringify(h.tree,(_key,value)=>typeof value==='function'?undefined:value);
const field=(h,label)=>{const node=h.find(n=>n.type==='label'&&[n.props.children].flat().filter(value=>typeof value==='string').join('')===label);assert.ok(node,label);return [node.props.children].flat().find(n=>['input','select'].includes(n?.type));};
const edit=(h,label,value)=>{field(h,label).props.onChange({target:{value}});h.flush();};
const submit=h=>{h.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});h.flush();};
const confirm=h=>{h.find(n=>n.type?.name==='FinanceReview').props.onConfirm();h.flush();};
const posts=h=>h.requests.filter(r=>['POST','PATCH'].includes(r.options.method));

test('all legacy finance links open the matching section without writes',()=>{
  for(const [tab,view] of Object.entries({'app-settings':'commissions','finance-operations':'overview','quick-third-party-settings':'shiprocket','delivery-rates':'rates','vendor-earnings':'earnings','vendor-payouts':'seller-payouts','delivery-earnings':'rider-earnings','rider-payouts':'payouts'})){
    const h=hookHarness(Center,{legacyTab:tab},'/admin/'+tab);try{assert.match(text(h),/Finance Center/);assert.ok(h.find(n=>n.type==='button'&&n.props['aria-pressed']===true&&n.props.onClick));assert.equal(h.requests.length,0);assert.ok(h.tree);const content=h.find(n=>n.props?.className==='finance-center-content');assert.equal(content.key,view);}finally{h.close();}
  }
});
test('Finance Center opens on the overview and exposes five areas',()=>{
  const h=hookHarness(Center,{},'/admin/finance-center');try{
    assert.equal(h.find(n=>n.props?.className==='finance-center-content').key,'overview');
    for(const area of ['Overview','Orders & COD','Payouts','Settings','Reports'])assert.ok(h.find(n=>n.type==='button'&&n.props.children===area),area);
    assert.equal(h.find(n=>n.props?.['aria-label']==='Finance Center sections'),undefined);
  }finally{h.close();}
});
test('area navigation persists shareable URLs and back/forward restores the section',()=>{
  const h=hookHarness(Center,{},'/admin/finance-center');try{
    h.click('Orders & COD');assert.match(window.location.search,/area=orders/);assert.match(text(h),/only orders that need you are flagged/);
    h.click('COD cash');assert.match(window.location.search,/view=cod/);
    h.click('Reports');h.click('Ledger & checks');assert.match(window.location.search,/view=ledger/);
    window.history.replaceState(null,'','/admin/finance-center?area=settings&view=charges');window.dispatchEvent(new Event('popstate'));h.flush();assert.ok(h.find(n=>n.type===Charges));
    assert.equal(posts(h).length,0);
  }finally{h.close();}
});
test('old shared links with the previous area names still open the same section',()=>{
  for(const [url,view] of [['?area=cod&view=ledger','ledger'],['?area=delivery&view=rider-earnings','rider-earnings'],['?area=vendors&view=courier-payments','courier-payments'],['?area=delivery&view=rider-rules','overview']]){
    const h=hookHarness(Center,{},'/admin/finance-center'+url);try{assert.equal(h.find(n=>n.props?.className==='finance-center-content').key,view,url);}finally{h.close();}
  }
});
test('invalid section URLs fall back safely to the overview',()=>{
  const h=hookHarness(Center,{},'/admin/finance-center?area=unknown&view=none');try{assert.equal(h.find(n=>n.props?.className==='finance-center-content').key,'overview');h.click('Settings');h.click('Payouts & tax');assert.ok(h.find(n=>n.type===Policy));assert.equal(posts(h).length,0);}finally{h.close();}
});
test('Finance Center remains a single reachable sidebar entry across admin sections',()=>{
  for(const activeTab of ['overview','user-dashboard','vendor-dashboard','delivery-dashboard','finance-center','quick-third-party-settings','delivery-rates','app-settings']){
    const selected=[];
    const h=hookHarness(Sidebar,{collapsed:false,setCollapsed(){}},'/admin/'+activeTab,{activeTab,setActiveTab:id=>selected.push(id),triggerToast(){}});
    try{const link=h.find(n=>n.type==='button'&&n.props.title==='Finance Center');assert.ok(link,activeTab);link.props.onClick();assert.deepEqual(selected,['finance-center']);if(['finance-center','quick-third-party-settings','delivery-rates','app-settings'].includes(activeTab))assert.match(link.props.className,/active/);assert.equal(h.find(n=>n.type==='button'&&n.props.title==='Quick 3P Settings'),undefined);}finally{h.close();}
  }
});
test('customer tariff loads persisted zero values, reviews and saves only its own API',async()=>{
  const h=hookHarness(Charges);try{
    h.requests[0].resolve({data:{current:{source:'configured',isActive:true,flatFee:0,distanceRates:{quick:3,same_day:4}},history:[]}});await h.settle();
    assert.equal(field(h,'Flat fallback charge (INR)').props.value,0);edit(h,'Flat fallback charge (INR)','12');submit(h);assert.equal(posts(h).length,0);confirm(h);
    assert.match(posts(h)[0].url,/delivery-charge$/);assert.deepEqual(JSON.parse(posts(h)[0].options.body),{flatFee:12});posts(h)[0].resolve({message:'Not approved'},409);await h.settle();assert.match(text(h),/Not approved/);
  }finally{h.close();}
});
test('unconfigured customer pricing shows no invented values or automatic tariff changes',async()=>{
  const h=hookHarness(Charges);try{h.requests[0].resolve({data:{current:{source:'default',flatFee:99},history:[]}});await h.settle();assert.equal(field(h,'Flat fallback charge (INR)').props.value,'');assert.match(text(h),/Not configured/);assert.equal(posts(h).length,0);}finally{h.close();}
});
test('distance tariffs require explicit opt-in, review and backend release approval',async()=>{
  const h=hookHarness(Charges);try{
    h.requests[0].resolve({data:{current:{source:'configured',flatFee:10,isActive:true,distanceRates:{quick:2,same_day:3}},history:[]}});await h.settle();
    h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});h.flush();
    edit(h,'Quick Commerce customer tariff (INR / km)','5');edit(h,'Same-Day customer tariff (INR / km)','6');edit(h,'Approved change reason','Synthetic approval fixture');submit(h);assert.equal(posts(h).length,0);confirm(h);
    assert.deepEqual(JSON.parse(posts(h)[0].options.body),{flatFee:10,distanceRates:{quick:5,same_day:6},note:'Synthetic approval fixture'});
    posts(h)[0].resolve({message:'Financial operation disabled'},503);await h.settle();assert.match(text(h),/Financial operation disabled/);
  }finally{h.close();}
});
test('rider draft preserves separation and surfaces backend rejection without activation',async()=>{
  const h=hookHarness(Rates,{mode:['quick','Quick Commerce'],current:{source:'default',perKm:999},onSaved:async()=>{}});try{
    assert.equal(field(h,'Distance pay (INR / km)').props.value,'');
    for(const [label,value] of [['Base pay (INR / delivery)','10'],['Distance pay (INR / km)','2'],['Minimum payout (INR)','0'],['Change reason','Synthetic fixture only']])edit(h,label,value);
    submit(h);assert.equal(posts(h).length,0);confirm(h);assert.match(posts(h)[0].url,/delivery-rates$/);assert.equal(JSON.parse(posts(h)[0].options.body).isActive,false);assert.equal(JSON.parse(posts(h)[0].options.body).perKm,2);
    posts(h)[0].resolve({message:'Invalid rate precision'},400);await h.settle();assert.match(text(h),/Invalid rate precision/);
  }finally{h.close();}
});
test('rider invalid limits prevent even the review step',()=>{
  const h=hookHarness(Rates,{mode:['quick','Quick Commerce'],onSaved:async()=>{}});try{for(const [label,value] of [['Base pay (INR / delivery)','10'],['Distance pay (INR / km)','2'],['Minimum payout (INR)','20'],['Maximum payout (INR, optional)','10'],['Change reason','Synthetic fixture']])edit(h,label,value);submit(h);assert.match(text(h),/Maximum payout must be at least/);assert.equal(posts(h).length,0);}finally{h.close();}
});
test('Shiprocket settings avoid operational fetch and save reviewed disabled draft with revision',async()=>{
  const h=hookHarness(Shiprocket,{view:'settings'});try{
    h.requests[0].resolve({data:{config:{revision:7,currency:'INR',enabled:false,paymentRequired:true,fee:{}},activationReady:false,blockers:['Approval required']}});await h.settle();assert.equal(h.requests.length,1);
    for(const [label,value] of [['Calculation method','flat'],['Fixed fee (INR)','10'],['Calculation base','vendor_freight_share'],['Tax treatment','exempt'],['Approved tax rate (%)','0'],['Business rule version','TEST-ONLY'],['Effective date/time (UTC)','2026-10-21T12:00']])edit(h,label,value);
    submit(h);assert.equal(posts(h).length,0);confirm(h);const payload=JSON.parse(posts(h)[0].options.body);assert.equal(payload.enabled,false);assert.equal(payload.paymentRequired,true);assert.equal(payload.revision,7);assert.equal(payload.effectiveAt,'2026-10-21T12:00:00.000Z');
    assert.match(posts(h)[0].url,/quick-commerce-third-party-config$/);posts(h)[0].resolve({message:'Revision conflict'},409);await h.settle();assert.match(text(h),/Revision conflict/);
  }finally{h.close();}
});
test('commission simulation: commission on the discounted price, seller paid on the full price',()=>{
  const rule={method:'percentage',value:'10',taxTreatment:'exclusive',taxRate:'18',minimum:'',maximum:''};
  assert.deepEqual(simulate(rule,'100','10'),{eligible:9000,discountPaidByBulkimart:1000,commission:900,tax:162,net:8938});
  assert.deepEqual(simulate({...rule,method:'fixed',value:'10',taxTreatment:'exempt',taxRate:'0'},'100','10'),{eligible:9000,discountPaidByBulkimart:1000,commission:1000,tax:0,net:9000});
  assert.deepEqual(simulate({...rule,method:'fixed',minimum:'20'},'100','100'),{eligible:0,discountPaidByBulkimart:10000,commission:0,tax:0,net:10000});
  assert.equal(simulate(rule,'','0'),null);assert.equal(simulate({...rule,value:'100'},'100','0').blocked,true);
  assert.equal(simulate({...rule,taxTreatment:'inclusive',value:'11.8'},'100','0').tax,180);
  assert.equal(simulate({...rule,maximum:'5'},'100','0').commission,500);
});
test('commission history loads authoritative rule metadata and never rewrites it on read',async()=>{
  const h=hookHarness(Commission);try{h.requests[0].resolve({data:{rules:[{_id:'fixture',channel:'quick',method:'fixed',value:5,isActive:false,version:'FIXTURE-V2',effectiveDate:'2026-10-21',taxTreatment:'exempt',taxRate:0,createdBy:'fixture-admin',reason:'Approved fixture only'}],flags:{snapshots:false}}});await h.settle();assert.match(text(h),/FIXTURE-V2/);assert.match(text(h),/fixture-admin/);assert.equal(posts(h).length,0);}finally{h.close();}
});
test('successful commission save reloads persisted audit history after review',async()=>{
  const h=hookHarness(Commission);try{
    h.requests[0].resolve({data:{rules:[],flags:{}}});await h.settle();
    for(const [label,value] of [['Commission value','5'],['GST rate on commission (%)','0'],['GST treatment','exempt'],['Starts from','2026-10-21T12:00'],['Change reason','Synthetic fixture approval']])edit(h,label,value);
    submit(h);assert.equal(posts(h).length,0);confirm(h);posts(h)[0].resolve({data:{version:'SAVED'}});await h.settle();
    h.requests.at(-1).resolve({data:{rules:[{_id:'fixture',version:'SAVED',channel:'ecommerce',method:'percentage',value:5,taxRate:0,taxTreatment:'exempt',effectiveDate:'2026-10-21',isActive:false,reason:'Synthetic fixture approval',createdBy:'fixture-admin'}],flags:{}}});await h.settle();assert.match(text(h),/SAVED/);assert.match(text(h),/Saved and reloaded from the server/);
  }finally{h.close();}
});
test('successful rider draft retains persisted inputs and invokes authoritative reload',async()=>{
  let reloads=0;
  const h=hookHarness(Rates,{mode:['quick','Quick Commerce'],current:{source:'configured',_id:'RATE-V1',base:11,perKm:2,minPayout:0,isActive:true,effectiveFrom:'2026-01-01'},onSaved:async()=>{reloads++;}});try{
    assert.equal(field(h,'Base pay (INR / delivery)').props.value,11);assert.match(text(h),/RATE-V1/);edit(h,'Change reason','Synthetic draft reason');submit(h);confirm(h);posts(h)[0].resolve({data:{_id:'RATE-V2',isActive:false}});await h.settle();assert.equal(reloads,1);assert.match(text(h),/Saved and reloaded/);assert.equal(JSON.parse(posts(h)[0].options.body).isActive,false);
  }finally{h.close();}
});
test('successful customer tariff update reloads saved zero tariff and history',async()=>{
  const h=hookHarness(Charges);try{
    h.requests[0].resolve({data:{current:{source:'configured',flatFee:10,isActive:true},history:[]}});await h.settle();edit(h,'Flat fallback charge (INR)','0');submit(h);confirm(h);posts(h)[0].resolve({data:{}});await h.settle();h.requests.at(-1).resolve({data:{current:{source:'configured',flatFee:0,isActive:true},history:[{_id:'TARIFF-ZERO',flatFee:0,isActive:true,createdAt:'2026-10-21',updatedBy:{name:'Fixture admin'}}]}});await h.settle();assert.equal(field(h,'Flat fallback charge (INR)').props.value,0);assert.match(text(h),/TARIFF-ZERO/);assert.match(text(h),/saved and reloaded/);
  }finally{h.close();}
});
test('Shiprocket loads persisted values and shows returned revision history after save',async()=>{
  const config={revision:2,enabled:false,paymentRequired:true,currency:'INR',effectiveAt:'2026-10-21T12:00:00.000Z',fee:{type:'flat',value:7,version:'FEE-V1',calculationBasis:'vendor_freight_share',minimum:null,maximum:null,taxTreatment:'exempt',taxRate:0}};
  const h=hookHarness(Shiprocket,{view:'settings'});try{
    h.requests[0].resolve({data:{config,activationReady:false,blockers:['Approval required']}});await h.settle();assert.equal(field(h,'Fixed fee (INR)').props.value,7);assert.equal(field(h,'Effective date/time (UTC)').props.value,'2026-10-21T12:00');edit(h,'Business rule version','FEE-V2');submit(h);confirm(h);posts(h)[0].resolve({data:{config:{...config,revision:3,history:[{revision:3,changedAt:'2026-10-21',changedBy:'fixture-admin',configuration:{version:'FEE-V2'}}]},activationReady:false}});await h.settle();assert.match(text(h),/FEE-V2/);assert.match(text(h),/Charging remains subject to all approval checks/);assert.equal(JSON.parse(posts(h)[0].options.body).enabled,false);
  }finally{h.close();}
});
test('overview shows setup gaps, to-do items with links and ledger totals without writing',async()=>{
  const opened=[];const h=hookHarness(Overview,{onNavigate:view=>opened.push(view)});try{
    assert.match(h.requests[0].url,/finance\/overview$/);
    h.requests[0].resolve({data:{flags:{snapshots:true,operations:false,payouts:false,policyApproved:true,testsApproved:true},commissionRulesConfigured:false,
      policy:{configured:false,bankVerificationConfigured:false,payoutSchedule:'weekly',payoutWeekday:1,tcsRatePercent:0.5,tdsRatePercent:0.1,sellerMinPayout:500,riderMinPayout:100},
      todo:{cashToVerify:2,cashMismatch:0,cashWithRiders:1,missingRule:0,waitingPayment:3,needsReview:1,onHold:4,sellerPayouts:0,riderPayouts:0},
      totalsPaise:{sellersOnHold:9040,sellersAvailable:0,sellersRequested:0,sellersPaid:0,ridersOnHold:4000,ridersAvailable:0,ridersRequested:0,ridersPaid:0,commission:900,commissionGst:0,tcs:50,tds:10,platformDiscounts:1000,codShortages:0,codCashWithRiders:10000}}});
    await h.settle();
    assert.match(text(h),/2 · COD handovers to check/);assert.match(text(h),/1 · Orders that need your review/);assert.doesNotMatch(text(h),/Seller payout requests/);
    assert.match(text(h),/₹90.40/);assert.match(text(h),/₹10.00/);assert.match(text(h),/every Monday/);
    assert.match(text(h),/✗ At least one commission rule is active/);
    const openButtons=[];(function walk(n){if(!n||typeof n!=='object')return;if(n.type==='button'&&n.props.children==='Open')openButtons.push(n);[n.props?.children].flat(Infinity).forEach(walk);})(h.tree);
    openButtons.forEach(button=>button.props.onClick());assert.ok(opened.includes('cod'));assert.ok(opened.includes('commissions'));assert.ok(opened.includes('policies'));
    assert.equal(posts(h).length,0);
  }finally{h.close();}
});
test('payout and tax policy loads, explains every field, reviews before saving and keeps errors visible',async()=>{
  const h=hookHarness(Policy);try{
    h.requests[0].resolve({data:{policy:{configured:false,revision:0,tcsRatePercent:0,tdsRatePercent:0,sellerMinPayout:0,riderMinPayout:100,payoutSchedule:'on_request',payoutWeekday:1,requireIndependentPayoutReviewer:true,bankVerificationMethod:'',history:[]},flags:{}}});await h.settle();
    assert.match(text(h),/Not saved yet/);assert.equal(field(h,'TCS rate (%)').props.value,0);
    for(const label of ['Payout schedule','Seller minimum payout (₹)','Rider minimum payout (₹)','TCS rate (%)','TDS rate (%)','Change reason']){const node=h.find(n=>n.type==='label'&&[n.props.children].flat().includes(label));assert.ok([node.props.children].flat().some(child=>child?.props?.className==='finance-hint'),label);}
    edit(h,'TCS rate (%)','9');edit(h,'Change reason','CA advice');submit(h);assert.match(text(h),/between 0 and 5/);assert.equal(posts(h).length,0);
    edit(h,'TCS rate (%)','0.5');edit(h,'TDS rate (%)','0.1');edit(h,'Seller minimum payout (₹)','500');edit(h,'Payout schedule','weekly');submit(h);assert.equal(posts(h).length,0);confirm(h);
    const put=posts(h)[0]||h.requests.find(r=>r.options.method==='PUT');assert.match(put.url,/finance\/policy$/);
    assert.deepEqual(JSON.parse(put.options.body),{tcsRatePercent:0.5,tdsRatePercent:0.1,sellerMinPayout:500,riderMinPayout:100,payoutSchedule:'weekly',payoutWeekday:1,requireIndependentPayoutReviewer:true,bankVerificationMethod:'',note:'CA advice',revision:0});
    put.resolve({message:'Finance policy changed; reload before saving'},409);await h.settle();assert.match(text(h),/reload before saving/);assert.equal(field(h,'TCS rate (%)').props.value,'0.5');
  }finally{h.close();}
});
test('tax report shows per-seller TCS/TDS, flags missing GSTIN/PAN and never writes',async()=>{
  const {TaxReportPanel}=await vite.ssrLoadModule('/src/modules/Admin/components/FinanceReports.jsx');
  const h=hookHarness(TaxReportPanel);try{
    assert.equal(h.requests.length,0);assert.ok(field(h,'Month'));
    edit(h,'Month','2026-10');submit(h);assert.match(h.requests[0].url,/finance\/tax-report\?month=2026-10$/);
    h.requests[0].resolve({data:{month:'2026-10',sellersMissingIds:1,rows:[{sellerId:'s1',sellerName:'Fixture Store',gstin:'',pan:'ABCDE1234F',grossPaise:10000,taxablePaise:8475,tcsPaise:42,tdsPaise:10,missing:['GSTIN']}],totals:{grossPaise:10000,taxablePaise:8475,tcsPaise:42,tdsPaise:10}}});await h.settle();
    assert.match(text(h),/Fixture Store/);assert.match(text(h),/₹84.75/);assert.match(text(h),/1 seller\(s\) are missing a GSTIN or PAN/);assert.equal(posts(h).length,0);
  }finally{h.close();}
});
test('accounting export shows a balanced trial balance with debit/credit sides',async()=>{
  const {AccountingExportPanel}=await vite.ssrLoadModule('/src/modules/Admin/components/FinanceReports.jsx');
  const h=hookHarness(AccountingExportPanel);try{
    edit(h,'From','2026-10-01');edit(h,'To','2026-10-23');submit(h);assert.match(h.requests[0].url,/trial-balance\?from=2026-10-01&to=2026-10-23$/);
    h.requests[0].resolve({data:{balanced:true,rows:[{account:'Bank',debitPaise:10000,creditPaise:0,balancePaise:10000},{account:'Seller payable',debitPaise:0,creditPaise:9000,balancePaise:-9000}],totals:{debitPaise:19000,creditPaise:19000}}});await h.settle();
    assert.match(text(h),/Debits equal credits/);assert.match(text(h),/₹90.00 Cr/);assert.match(text(h),/₹100.00 Dr/);assert.equal(posts(h).length,0);
  }finally{h.close();}
});
test('reports area lists tax and accounting sections',()=>{
  const h=hookHarness(Center,{},'/admin/finance-center?area=reports');try{
    for(const label of ['Ledger & checks','Tax reports','Accounting export','Old orders'])assert.ok(h.find(n=>n.type==='button'&&n.props.children===label),label);
    h.click('Tax reports');assert.match(window.location.search,/view=tax/);
  }finally{h.close();}
});
