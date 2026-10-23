import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {hookHarness} from '../tests/service-hookHarness.mjs';
let vite,Modal,Detail,Settings;
before(async()=>{vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});Modal=(await vite.ssrLoadModule('/src/modules/Seller/components/ProductModal.jsx')).default;Detail=(await vite.ssrLoadModule('/src/modules/User/pages/ProductDetailPage.jsx')).default;Settings=(await vite.ssrLoadModule('/src/modules/Admin/components/ReturnPolicySettingsTab.jsx')).default;});
after(async()=>vite?.close());
const text=node=>node==null?'':typeof node!=='object'?String(node):[node.props?.children].flat(Infinity).map(text).join(' ');
const category='507f1f77bcf86cd799439021',id='507f1f77bcf86cd799439022';
function editor(type='ecommerce',extra={}){
  const ctx={showAddProductModal:true,setShowAddProductModal:()=>{},activeChannel:type,productListingMode:'retail',editingProductId:id,editingProduct:{_id:id,type,category,images:['https://example.test/a.jpg']},
    newProductForm:{name:'Return test product',fulfillmentType:'physical',returnable:true,returnWindowDays:'3',categoryId:category,variants:[{name:'Default',price:100,mrp:100,stock:1,unit:'piece'}]},platformLimits:{},triggerToast:()=>{},...extra};
  ctx.setNewProductForm=next=>{ctx.newProductForm=typeof next==='function'?next(ctx.newProductForm):next;};
  const h=hookHarness(Modal,{},'/seller/products',ctx);return {h,ctx};
}
async function categories(h){h.requests.find(r=>r.url.includes('/categories/tree')).resolve({data:[{_id:category,name:'Test category',children:[]}]});await h.settle();}
for(const type of ['grocery','ecommerce'])test(type+' seller can set return days and see the customer policy preview',async()=>{
  const {h,ctx}=editor(type);try{await categories(h);h.requests.find(r=>r.url.includes('category-return-policy')).resolve({data:{eligible:true,returnWindowDays:7}});await h.settle();
    assert.match(text(h.tree),/Allow Returns/);assert.match(text(h.tree),/3 days return available/);
    const input=h.find(n=>n.type==='input'&&n.props.type==='number'&&n.props.max===7);assert.ok(input);input.props.onChange({target:{value:'5'}});h.rerender();assert.equal(ctx.newProductForm.returnWindowDays,'5');assert.match(text(h.tree),/5 days return available/);
    const label=h.find(n=>n.type==='label'&&text(n).includes('Allow Returns'));h.find(n=>n.type==='input',label).props.onChange({target:{checked:false}});h.rerender();assert.match(text(h.tree),/Customers will see: Non-Returnable/);
  }finally{h.close();}
});
test('a failed category check has retry instead of claiming returns are unavailable',async()=>{
  const {h}=editor();try{await categories(h);h.requests.find(r=>r.url.includes('category-return-policy')).resolve({message:'Failure'},503);await h.settle();assert.match(text(h.tree),/could not be checked/);
    assert.doesNotMatch(text(h.tree),/no active return window/);h.click('Retry return policy');h.requests.findLast(r=>r.url.includes('category-return-policy')).resolve({data:{eligible:true,returnWindowDays:7}});await h.settle();assert.match(text(h.tree),/Category limit:.*7 days/);
  }finally{h.close();}
});
test('Shop All customer page shows the server-resolved return window',async()=>{
  const ctx={selectedProduct:{id,name:'Test product',type:'ecommerce',price:100,stock:1,variants:[]},currentUser:null,getItemQty:()=>0,getDeliveryPoint:()=>null,getSelectedAddress:()=>null,getLocationDisplayName:()=>'',isWishlisted:()=>false,toggleWishlist(){},setSelectedProduct(){},setActiveNav(){},addToCart:async()=>({ok:true})};
  const h=hookHarness(Detail,{},'/?product='+id,ctx);
  try{h.requests.find(r=>r.url.endsWith('/api/products/'+id)).resolve({_id:id,variants:[],returnPolicy:{eligible:true,returnWindowDays:3}});await h.settle();assert.match(text(h.tree),/3.*Days Return Available/);}
  finally{h.close();}
});
test('seller sees the global limit and must explicitly opt in an unconfigured Shop All product',async()=>{
  const {h,ctx}=editor();try{
    await categories(h);h.requests.find(r=>r.url.includes('category-return-policy')).resolve({data:{eligible:true,returnWindowDays:7,source:'global'}});await h.settle();h.rerender();
    assert.equal(ctx.newProductForm.returnable,false);assert.match(text(h.tree),/Global limit:.*7 days/);
    const label=h.find(n=>n.type==='label'&&text(n).includes('Allow Returns'));h.find(n=>n.type==='input',label).props.onChange({target:{checked:true}});h.rerender();
    assert.match(text(h.tree),/3 days return available/);
  }finally{h.close();}
});
test('admin edits global settings while missing categories display their inherited default',async()=>{
  const notices=[],h=hookHarness(Settings,{},'/admin/return-policies',{triggerToast:value=>notices.push(value)});
  try{
    const rows=[{categoryId:category,categoryName:'Unconfigured category',channel:'ecommerce',policy:null}];
    h.requests[0].resolve({data:rows,meta:{globalPolicy:{returnWindowDays:7,isActive:true,version:1},maxWindowDays:365}});await h.settle();
    assert.match(text(h.tree),/Global default: up to 7 days/);
    h.find(n=>n.props?.['aria-label']==='Global return window in days').props.onChange({target:{value:'14'}});h.flush();
    const save=h.click('Save global return window');assert.match(h.requests[1].url,/\/return-policies\/global$/);
    assert.deepEqual(JSON.parse(h.requests[1].options.body),{returnWindowDays:14,isActive:true,version:1});
    h.requests[1].resolve({data:{returnWindowDays:14,isActive:true,version:2},message:'Saved global window'});await h.settle();
    h.requests[2].resolve({data:rows,meta:{globalPolicy:{returnWindowDays:14,isActive:true,version:2},maxWindowDays:365}});await save;await h.settle();
    assert.match(text(h.tree),/Saved global limit: 14 days/);assert.match(notices.at(-1),/Saved global window/);
  }finally{h.close();}
});
test('blank global days cannot silently save zero',async()=>{
  const notices=[],h=hookHarness(Settings,{},'/admin/return-policies',{triggerToast:value=>notices.push(value)});
  try{h.requests[0].resolve({data:[],meta:{globalPolicy:null,maxWindowDays:365}});await h.settle();await h.click('Save global return window');assert.equal(h.requests.length,1);assert.match(notices.at(-1),/valid whole number/);}finally{h.close();}
});
