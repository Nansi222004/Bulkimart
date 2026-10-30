const count = value => Number.isSafeInteger(value) && value >= 0;
const amount = value => Number.isSafeInteger(value);
export function readDashboardOverview(data) {
  if (!data || ['totalOrders','ecommerceOrders','groceryOrders','totalUsers','totalSellers','pendingSellers'].some(key=>!count(data[key]))
    || ['recentOrders','lowStockAlerts','recentSellers','ecommerceCategories','quickCommerceCategories'].some(key=>!Array.isArray(data[key]))
    || data.recentOrders.some(row=>!row?.id || (row.amount !== null && (typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount < 0)))) throw Error('Invalid overview');
  return data;
}
export function readDashboardFinance(data) {
  if (!data || data.version!==1 || data.currency!=='INR' || data.unit!=='paise' || data.scope!=='all-time' || data.timezone!=='Asia/Kolkata' || !Number.isFinite(Date.parse(data.asOf))) throw Error('Invalid financial contract');
  for (const key of ['orderValue','collections','platformRevenue']) {
    const row=data[key];
    if (!row || !['complete','incomplete','unavailable'].includes(row.status) || !amount(row.verifiedSubtotalPaise) || !count(row.incompleteRecords) || !count(row.excludedRecords)
      || (row.status==='complete' ? !amount(row.amountPaise) || row.amountPaise!==row.verifiedSubtotalPaise || row.incompleteRecords!==0 : row.amountPaise!==null)
      || (key!=='platformRevenue' && row.verifiedSubtotalPaise<0) || (row.status==='unavailable' && key==='platformRevenue' && typeof row.blocker!=='string')) throw Error('Invalid financial metric');
    if (row.issues !== undefined && (!Array.isArray(row.issues) || row.issues.some(issue => !issue || typeof issue.code!=='string' || !count(issue.count) || issue.count===0 || typeof issue.message!=='string' || typeof issue.resolution!=='string'))) throw Error('Invalid financial issues');
    if (row.breakdown !== undefined && (!row.breakdown || typeof row.breakdown!=='object' || ['orderCommissionPaise','parcelRevenuePaise','advertisingRevenuePaise'].some(component=>!amount(row.breakdown[component])) || Object.values(row.breakdown).reduce((sum,value)=>sum+value,0)!==row.verifiedSubtotalPaise)) throw Error('Invalid revenue breakdown');
  }
  return data;
}
export const dashboardMoney = value => typeof value==='number' && Number.isFinite(value) ? `₹${value.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}` : 'Unavailable';

export const dashboardStatusLabels = {
  placed:'Placed', confirmed:'Confirmed', preparing:'Preparing', dispatched:'Dispatched',
  out_for_delivery:'Out for delivery', delivered:'Delivered', cancelled:'Cancelled',
  return_requested:'Return requested', returned:'Returned', refunded:'Refunded', unknown:'Unknown / Unattributed',
};
export const dashboardChannelLabels = {ecommerce:'E-Commerce', grocery:'Quick Commerce', subscription:'Subscription', unknown:'Unknown / Unattributed'};
export const dashboardSalesLabels = {retail:'Retail', wholesale:'Wholesale', unknown:'Unknown / Unattributed'};

export function readDashboardOrderAnalytics(data) {
  if (!data || data.version!==1 || data.scope!=='all-time' || data.timezone!=='Asia/Kolkata' || data.unit!=='orders'
    || data.measure!=='fulfilment-orders' || !Number.isFinite(Date.parse(data.asOf)) || !count(data.totalOrders)) throw Error('Invalid order analytics contract');
  for (const [key,labels] of [['statuses',dashboardStatusLabels],['channels',dashboardChannelLabels],['salesChannels',dashboardSalesLabels]]) {
    const rows=data[key], seen=new Set();
    if (!Array.isArray(rows)) throw Error('Invalid order distribution');
    let total=0;
    for (const row of rows) {
      if (!row || !Object.hasOwn(labels,row.key) || seen.has(row.key) || !count(row.count) || row.count===0) throw Error('Invalid order group');
      seen.add(row.key); total+=row.count;
      if (!count(total)) throw Error('Invalid order count');
    }
    if (total!==data.totalOrders) throw Error('Inconsistent order distribution');
  }
  return data;
}
