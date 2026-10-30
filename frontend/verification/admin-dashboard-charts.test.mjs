import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {hookHarness} from './componentHarness.mjs';

let vite,charts,read;
before(async()=>{
  vite=await createServer({configFile:false,plugins:[react()],server:{middlewareMode:true,hmr:false},appType:'custom'});
  charts=await vite.ssrLoadModule('/src/modules/Admin/components/DashboardCharts.jsx');
  read=await vite.ssrLoadModule('/src/modules/Admin/utils/dashboardRead.js');
});
after(async()=>vite.close());
const text=h=>JSON.stringify(h.tree,(_key,value)=>typeof value==='function'?undefined:value);
const observed='2026-10-23T12:00:00Z';
const analytics=()=>({version:1,scope:'all-time',timezone:'Asia/Kolkata',unit:'orders',measure:'fulfilment-orders',asOf:observed,totalOrders:3,
  statuses:[{key:'delivered',count:2},{key:'unknown',count:1}],channels:[{key:'grocery',count:1},{key:'unknown',count:2}],salesChannels:[{key:'wholesale',count:1},{key:'unknown',count:2}]});
const metric=()=>({status:'complete',amountPaise:0,verifiedSubtotalPaise:0,incompleteRecords:0,excludedRecords:0});
const finance=()=>({version:1,currency:'INR',unit:'paise',scope:'all-time',timezone:'Asia/Kolkata',asOf:observed,
  orderValue:{...metric(),amountPaise:12345,verifiedSubtotalPaise:12345},collections:{...metric(),amountPaise:5678,verifiedSubtotalPaise:5678},
  platformRevenue:{...metric(),status:'unavailable',amountPaise:null,verifiedSubtotalPaise:1250,blocker:'Recognition policy is not approved.'}});

test('financial comparison uses verified API amounts, converts paise once and never charts recognized revenue',()=>{
  const h=hookHarness(charts.FinancialOverviewChart,{finance:finance()});
  try {
    const body=text(h);for(const value of ['₹123.45','₹56.78','₹12.50','Posted Bulkimart revenue','not a historical trend'])assert.ok(body.includes(value));
    assert.ok(!body.includes('₹12,345.00'));
    const figure=h.find(node=>node.type==='figure');assert.equal(figure.props['aria-label'],'Order value and collections · INR');
    assert.equal(figure.props.children[1].props.children.length,2);
    assert.match(body,/Gross completed order value|Net verified external collections/);
    assert.match(body,/Net posted merchandise commission subtotal only/);
  } finally {h.close();}
});

test('genuine financial zero stays labelled zero; incomplete totals have no bar',()=>{
  const value=finance();value.orderValue=metric();value.collections={...metric(),status:'incomplete',amountPaise:null,verifiedSubtotalPaise:999,incompleteRecords:2};
  const h=hookHarness(charts.FinancialOverviewChart,{finance:value});
  try {
    assert.ok(text(h).includes('₹0.00'));assert.ok(text(h).includes('₹9.99'));assert.match(text(h),/Verified records subtotal only/);
    const rows=h.find(node=>node.type==='figure').props.children[1].props.children;
    assert.equal(rows.length,1);assert.equal(rows[0].key,'orderValue');assert.match(text(h),/2/);
  } finally {h.close();}
});

test('available posted income replaces the permanent revenue-unavailable message',()=>{
  const value=finance();value.platformRevenue={...metric(),amountPaise:1020,verifiedSubtotalPaise:1020,basis:'Net posted commissions and earned fees'};
  const h=hookHarness(charts.FinancialOverviewChart,{finance:value});
  try {assert.match(text(h),/Posted Bulkimart revenue/);assert.match(text(h),/₹10.20/);assert.doesNotMatch(text(h),/revenue: unavailable|not recognized platform-wide revenue/);} finally {h.close();}
});

test('loading, missing, malformed and permission errors cannot render financial zero bars',()=>{
  for(const props of [{loading:true},{},{finance:{...finance(),unit:'rupees'}},{finance:null,error:'403 private server detail'}]){
    const h=hookHarness(charts.FinancialOverviewChart,props);
    try {assert.equal(h.find(node=>node.type==='figure'),undefined);assert.ok(!text(h).includes('₹0.00'));assert.ok(!text(h).includes('private server detail'));assert.match(text(h),props.loading?/Loading/:/unavailable/);} finally {h.close();}
  }
  let retried=0;const h=hookHarness(charts.FinancialOverviewChart,{error:'Denied',onRetry:()=>retried++});
  try{h.click('Retry financial chart');assert.equal(retried,1);}finally{h.close();}
});

test('order contract rejects missing, duplicate, unknown keys, wrong units and inconsistent totals; empty zero is valid',()=>{
  const empty={...analytics(),totalOrders:0,statuses:[],channels:[],salesChannels:[]};assert.equal(read.readDashboardOrderAnalytics(empty).totalOrders,0);
  for(const data of [null,{}, {...analytics(),totalOrders:'3'}, {...analytics(),unit:'paise'}, {...analytics(),channels:[]},
    {...analytics(),statuses:[{key:'unapproved_status',count:3}]},{...analytics(),statuses:[{key:'delivered',count:1},{key:'delivered',count:2}]},
    {...analytics(),statuses:[{key:'unknown',count:3.1}]},{...analytics(),statuses:[{key:'unknown',count:0}]}, {...analytics(),asOf:'invalid'}])assert.throws(()=>read.readDashboardOrderAnalytics(data));
});

test('one authenticated API response supplies both charts, canonical labels and separate sales classification',async()=>{
  const h=hookHarness(charts.OrderAnalyticsCharts);
  try {
    assert.match(text(h),/Loading order analytics/);assert.equal(h.requests.length,1);assert.match(h.requests[0].url,/\/api\/admin\/dashboard\/order-analytics$/);
    assert.equal(h.requests[0].options.headers.Authorization,'Bearer fixture-only-token');
    h.requests[0].resolve({success:true,data:analytics()});await h.settle();
    const body=text(h);for(const label of ['Orders Performance','Orders by Channel','Delivered','Quick Commerce','Unknown / Unattributed','Wholesale: 1','distinct fulfilment Orders','separate from financial snapshot'])assert.ok(body.includes(label));
    assert.equal(h.requests.length,1);assert.ok(h.find(node=>node.type==='figure' && node.props['aria-label']==='Orders by Channel · order counts'));
  } finally {h.close();}
});

test('genuine empty results differ from malformed, HTTP and permission failures; retry clears old data',async()=>{
  for(const scenario of ['empty','malformed','failure','permission']) {
    const h=hookHarness(charts.OrderAnalyticsCharts);
    try {
      const data=scenario==='empty'?{...analytics(),totalOrders:0,statuses:[],channels:[],salesChannels:[]}:scenario==='malformed'?{}:null;
      h.requests[0].resolve({success:scenario==='empty'||scenario==='malformed',data,message:'Private failure'},scenario==='permission'?403:scenario==='failure'?500:200);await h.settle();
      assert.match(text(h),scenario==='empty'?/No fulfilment Orders found/:/could not be verified/);assert.ok(!text(h).includes('Private failure'));
      assert.equal(h.find(node=>node.type==='figure'),undefined);
      if(scenario!=='empty'){
        const retry=h.click('Retry order analytics');assert.match(text(h),/Loading/);h.requests.at(-1).resolve({success:true,data:analytics()});await retry;await h.settle();
        assert.match(text(h),/Delivered/);
        const refresh=h.click('Refresh order analytics');assert.ok(!text(h).includes('Delivered'));h.requests.at(-1).reject(Error('Offline'));await refresh;await h.settle();
        assert.match(text(h),/could not be verified/);assert.equal(h.find(node=>node.type==='figure'),undefined);
      }
    } finally {h.close();}
  }
});

test('generation guard rejects older responses even when fetch ignores abort; session changes clear charts',async()=>{
  const h=hookHarness(charts.OrderAnalyticsCharts);
  try {
    h.requests[0].resolve({success:true,data:analytics()});await h.settle();
    const refresh=h.find(node=>node.type==='button' && node.props.children==='Refresh order analytics').props.onClick;
    const old=refresh(),oldRequest=h.requests.at(-1);const current=refresh(),newRequest=h.requests.at(-1);h.flush();
    newRequest.resolve({success:true,data:analytics()});await current;await h.settle();
    oldRequest.resolve({success:true,data:{}});await old;await h.settle();assert.match(text(h),/Delivered/);assert.ok(!text(h).includes('could not be verified'));
    window.dispatchEvent(new Event('bulkimart:admin-session-changed'));h.flush();assert.equal(h.find(node=>node.type==='figure'),undefined);assert.match(text(h),/Sign in again/);
  } finally {h.close();}
});

test('unmounted charts ignore late responses',async()=>{
  const h=hookHarness(charts.OrderAnalyticsCharts);
  try {h.unmount();const before=h.updates;h.requests[0].resolve({success:true,data:analytics()});await h.settle();assert.equal(h.updates,before);} finally {h.close();}
});
