import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {hookHarness} from './componentHarness.mjs';
let vite,Dashboard,Provider,read;
before(async()=>{vite=await createServer({configFile:false,plugins:[react()],server:{middlewareMode:true,hmr:false},appType:'custom'});Dashboard=(await vite.ssrLoadModule('/src/modules/Admin/pages/SuperAdminDashboard.jsx')).SuperAdminDashboard;Provider=(await vite.ssrLoadModule('/src/modules/Admin/context/AdminContext.jsx')).AdminProvider;read=await vite.ssrLoadModule('/src/modules/Admin/utils/dashboardRead.js');});
after(async()=>vite.close());
const text=h=>JSON.stringify(h.tree,(_key,value)=>typeof value==='function'?undefined:value);
const overview=()=>({totalOrders:0,ecommerceOrders:0,groceryOrders:0,totalUsers:0,totalSellers:1,pendingSellers:2,recentOrders:[],lowStockAlerts:[],recentSellers:[],ecommerceCategories:[],quickCommerceCategories:[]});
const metric=()=>({status:'complete',amountPaise:0,verifiedSubtotalPaise:0,incompleteRecords:0,excludedRecords:0});
const finance=()=>({version:1,currency:'INR',unit:'paise',scope:'all-time',timezone:'Asia/Kolkata',asOf:'2026-10-23T12:00:00Z',orderValue:metric(),collections:metric(),platformRevenue:{...metric(),status:'unavailable',amountPaise:null,blocker:'Recognition requires approved accounting policy.'}});
test('covered zero, approved sellers, three distinct KPIs and unavailable recognized revenue',()=>{
  const h=hookHarness(Dashboard,{},'/admin',{dashboardOverview:overview(),dashboardFinance:finance(),sellerCounts:{approved:100,pending:200},fetchDashboardOverview(){}});
  try{const body=text(h);assert.match(body,/Total Order Value/);assert.match(body,/Money Collected/);assert.match(body,/Bulkimart Revenue/);assert.match(body,/₹0.00/);assert.match(body,/Posted merchandise commission/);assert.match(body,/Unavailable/);assert.doesNotMatch(body,/Total Revenue|300/);}finally{h.close();}
});
for(const state of ['loading','error','finance-error'])test(state+' does not invent financial zeros',()=>{
  const context={fetchDashboardOverview(){},dashboardOverview:state==='finance-error'?overview():null,dashboardOverviewLoading:state==='loading',dashboardOverviewError:state==='error'?'Dashboard could not be verified':'',dashboardFinanceError:state==='finance-error'?'Finance unavailable':''};
  const h=hookHarness(Dashboard,{},'/admin',context);try{assert.doesNotMatch(text(h),/₹0.00/);assert.match(text(h),state==='loading'?/Loading/:state==='error'?/could not be verified/:/Finance unavailable/);}finally{h.close();}
});
test('recent amount is canonical rupees; partial collections never appear as an authoritative total',()=>{
  const ov=overview();ov.recentOrders=[{id:'order',amount:95,status:'delivered'}];const f=finance();f.collections={...metric(),status:'incomplete',amountPaise:null,verifiedSubtotalPaise:1250,incompleteRecords:1};
  const h=hookHarness(Dashboard,{},'/admin',{dashboardOverview:ov,dashboardFinance:f,fetchDashboardOverview(){}});
  try{assert.match(text(h),/Order amount:|₹95.00/);assert.match(text(h),/Verified records subtotal|₹12.50/);assert.match(text(h),/records need reconciliation/);}finally{h.close();}
});

test('recent orders show readable references, IST dates, clear statuses and open the real orders page',()=>{
  const ov=overview();ov.recentOrders=[{id:'507f1f77bcf86cd799439011',orderNo:'ORD-20261026-REFERENCE',buyerName:'Customer',type:'grocery',amount:940,status:'out_for_delivery',createdAt:'2026-10-25T20:00:00Z'}];
  let destination;
  const h=hookHarness(Dashboard,{},'/admin',{dashboardOverview:ov,dashboardFinance:finance(),fetchDashboardOverview(){},setActiveTab(value){destination=value;}});
  try {
    const order=h.find(node=>node.props?.className==='sa-recent-order-number');assert.equal(order.props.children,'ORD-20261026-REFERENCE');
    const status=h.find(node=>String(node.props?.className).includes('sa-recent-order-status'));assert.equal(status.props.children,'Out for delivery');
    const date=h.find(node=>node.type==='time');assert.match([date.props.children].flat().join(''),/26 Oct 2026/);assert.match([date.props.children].flat().join(''),/IST/);
    assert.ok(h.find(node=>node.props?.className==='sa-recent-order-amount' && node.props.children==='₹940.00'));
    assert.equal(h.find(node=>node.type==='ul' && node.props['aria-label']==='Recent orders').props.tabIndex,0);
    h.click('View All Orders');assert.equal(destination,'user-orders');
  } finally {h.close();}
});
test('malformed successful responses fail contract validation instead of becoming zero',()=>{
  for(const data of [null,{}, {...overview(),totalOrders:'17'}, {...overview(),recentOrders:[{id:'x'}]}])assert.throws(()=>read.readDashboardOverview(data));
  for(const data of [null,{}, {...finance(),unit:'rupees'}, {...finance(),collections:{...metric(),amountPaise:null}}, {...finance(),orderValue:{...metric(),amountPaise:'0'}}])assert.throws(()=>read.readDashboardFinance(data));
  assert.equal(read.readDashboardFinance(finance()).collections.amountPaise,0);
});

test('posted revenue and partial collections display real amounts with explicit coverage and a reconciliation route',()=>{
  const f=finance();f.collections={...metric(),status:'incomplete',amountPaise:null,verifiedSubtotalPaise:280000,incompleteRecords:2,issues:[{code:'capture_missing',count:2,message:'Missing payment capture.',resolution:'Verify original gateway receipts.'}]};
  f.platformRevenue={...metric(),status:'incomplete',amountPaise:null,verifiedSubtotalPaise:1020,incompleteRecords:3,breakdown:{orderCommissionPaise:0,parcelRevenuePaise:1020,advertisingRevenuePaise:0},basis:'Posted commission and earned parcel income.'};
  assert.equal(read.readDashboardFinance(f).platformRevenue.verifiedSubtotalPaise,1020);
  let destination;
  const h=hookHarness(Dashboard,{},'/admin',{dashboardOverview:overview(),dashboardFinance:f,fetchDashboardOverview(){},setActiveTab(value){destination=value;}});
  try {
    const body=text(h);assert.match(body,/₹2,800.00/);assert.match(body,/₹10.20/);assert.match(body,/Verified subtotal · reconciliation pending/);assert.match(body,/Missing payment capture/);assert.doesNotMatch(body,/Recognized platform-wide revenue is not configured/);
    h.click('Open Finance Center');assert.equal(destination,'finance-center');
  } finally {h.close();}
  f.platformRevenue={...metric(),amountPaise:1020,verifiedSubtotalPaise:1020};
  assert.equal(read.readDashboardFinance(f).platformRevenue.status,'complete');
});
test('actual context clears stale data, handles failure and retry, and rejects older concurrent responses',async()=>{
  const h=hookHarness(Provider,{},'/admin',undefined,{localStorage:{getItem:()=>null,removeItem(){}}});
  try{
    const first=h.tree.props.value.fetchDashboardOverview();h.flush();const firstReads=h.requests.filter(row=>row.url.includes('/dashboard/'));
    const second=h.tree.props.value.fetchDashboardOverview();h.flush();const secondReads=h.requests.filter(row=>row.url.includes('/dashboard/')).slice(-2);
    secondReads[0].resolve({success:true,data:overview()});secondReads[1].resolve({success:true,data:finance()});await second;await h.settle();
    firstReads[0].resolve({success:true,data:{...overview(),totalOrders:999}});firstReads[1].resolve({success:true,data:{}});await first;await h.settle();
    assert.equal(h.tree.props.value.dashboardOverview.totalOrders,0);assert.equal(h.tree.props.value.dashboardFinance.collections.amountPaise,0);
    const retry=h.tree.props.value.fetchDashboardOverview();h.flush();assert.equal(h.tree.props.value.dashboardFinance,null);
    const reads=h.requests.filter(row=>row.url.includes('/dashboard/')).slice(-2);reads[0].resolve({success:true,data:overview()});reads[1].resolve({success:false,message:'sensitive server failure'},500);await retry;await h.settle();
    assert.equal(h.tree.props.value.dashboardFinance,null);assert.match(h.tree.props.value.dashboardFinanceError,/unavailable/);assert.doesNotMatch(h.tree.props.value.dashboardFinanceError,/sensitive/);
  }finally{h.close();}
});
