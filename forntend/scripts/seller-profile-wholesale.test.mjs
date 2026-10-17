import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './service-hookHarness.mjs';
let vite,Profile,Editor,Provider,Modes,Wholesale,Products,Modal,Variant,Selector,validate,notifications,clearRequests;
const id='507f1f77bcf86cd799439015',variantId='507f1f77bcf86cd799439016';
const seller={_id:id,__v:0,status:'approved',businessName:'Actual business',salesChannels:['ecommerce','grocery','wholesale'],wholesaleChannel:{status:'approved'},userId:{_id:'507f1f77bcf86cd799439019',name:'Real Owner',phone:'9876500001',email:'owner@example.invalid'},storeDetails:{name:'Real Store',phone:'9876500002',email:'store@example.invalid',city:'Pune'}};
const product={_id:id,__v:0,name:'Physical fixture',type:'grocery',fulfillmentType:'physical',isActive:true,status:'approved',category:{_id:'507f1f77bcf86cd799439018',name:'Fixture',isActive:true},variants:[{_id:variantId,name:'Case',price:100,mrp:120,stock:100,unit:'piece'}],images:[]};
const storage=()=>{const values=new Map([['sellerToken','seller-fixture'],['sellerUserProfile',JSON.stringify(seller.userId)]]);return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};};
const text=node=>node==null?'':typeof node!=='object'?String(node):[node.props?.children].flat(Infinity).map(text).join(' ');
before(async()=>{
  vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
  const load=path=>vite.ssrLoadModule('/src/'+path);
  const profile=await load('modules/Seller/components/ProfileTab.jsx');Profile=profile.default;Editor=profile.SellerProfileEditor;
  Provider=(await load('modules/Seller/context/SellerContext.jsx')).SellerProvider;
  Modes=(await load('modules/Seller/components/ProductSellingModes.jsx')).default;
  Wholesale=(await load('modules/Seller/components/SellerWholesaleProducts.jsx')).default;
  Products=(await load('modules/Seller/components/ProductsTab.jsx')).default;
  Selector=(await load('modules/Seller/components/WholesaleOfferSelector.jsx')).default;
  Modal=(await load('modules/Seller/components/ProductModal.jsx')).default;
  Variant=(await load('modules/Seller/components/VariantWholesaleFields.jsx')).default;
  validate=(await load('modules/Seller/utils/wholesaleOffer.js')).validateWholesaleOffer;
  notifications=(await load('utils/useNotifications.js')).useNotifications;
  clearRequests=(await load('utils/portalRequests.js')).clearPortalRequests;
  (await load('utils/socket.js')).socket.connect=()=>{};
});
after(async()=>vite.close());
beforeEach(()=>clearRequests('seller'));

test('new Wholesale draft has explicit Wholesale-only channels, no retail price book and no previous variant IDs',()=>{
  const h=hookHarness(Provider,{},'/seller/products',undefined,{localStorage:storage()});
  try{h.tree.props.value.startEditProduct(product);h.flush();h.tree.props.value.startNewWholesaleProduct();h.flush();const state=h.tree.props.value;assert.equal(state.editingProductId,null);assert.deepEqual(state.newProductForm.sellingChannels,['wholesale']);assert.equal(state.newProductForm.variants[0]._id,undefined);assert.equal(state.newProductForm.variants[0].price,0);assert.equal(state.newProductForm.variants[0].wholesalePricing.enabled,true);assert.equal(state.activeMode,'ecommerce');}finally{h.close();}
});
test('new Wholesale uses one multipart creation with photos and terms; failed request retains draft and duplicate submissions are locked',async()=>{
  const h=hookHarness(Provider,{},'/seller/products',undefined,{localStorage:storage()});
  try{
    h.tree.props.value.startNewWholesaleProduct();h.flush();const form={...h.tree.props.value.newProductForm,name:'New Wholesale fixture',categoryId:product.category._id,variants:[{name:'Case',price:0,mrp:0,stock:100,unit:'pack',sku:'NEW-SKU',attributes:[{name:'Size',value:'Large'}],wholesalePricing:{enabled:true,minimumQuantity:10,quantityIncrement:5,priceTiers:[{minimumQuantity:10,unitPrice:95}]}}]};
    const pending=h.tree.props.value.submitNewProduct(form,[{file:new Blob(['fixture'],{type:'image/png'})}]);h.tree.props.value.submitNewProduct(form,[]);
    const writes=h.requests.filter(r=>r.options.method==='POST'&&r.url.endsWith('/api/products'));assert.equal(writes.length,1);
    const fd=writes[0].options.body;assert.deepEqual(JSON.parse(fd.get('sellingChannels')),['wholesale']);assert.equal(fd.get('type'),'ecommerce');assert.equal(fd.getAll('images').length,1);const v=JSON.parse(fd.get('variants'))[0];assert.equal(v.price,0);assert.equal(v.wholesalePricing.priceTiers[0].unitPrice,95);assert.equal(v.sku,'NEW-SKU');assert.equal(fd.has('sameDay'),false);
    writes[0].resolve({message:'Fixture failure'},409);await pending;h.flush();assert.match(h.tree.props.value.productError,/Fixture failure/);assert.equal(h.tree.props.value.showAddProductModal,true);assert.deepEqual(h.tree.props.value.newProductForm.sellingChannels,['wholesale']);
  }finally{h.close();}
});
test('Wholesale creation reuses general/category/variants/photos and permits unsaved variant terms without retail pricing controls',()=>{
  const form={name:'New physical',fulfillmentType:'physical',sellingChannels:['wholesale'],variants:[{name:'Case',price:0,mrp:0,stock:100,unit:'piece',wholesalePricing:{enabled:true,minimumQuantity:10,quantityIncrement:5,priceTiers:[{minimumQuantity:10,unitPrice:95}]}}]};
  const h=hookHarness(Modal,{},'/seller/products',{showAddProductModal:true,productListingMode:'wholesale',sellerProfile:seller,newProductForm:form,setNewProductForm(){},platformLimits:{}},{localStorage:storage()});
  try{assert.match(text(h.tree),/Add Wholesale Product/);assert.match(text(h.tree),/Wholesale only/);h.find(n=>n.type==='button'&&text(n).includes('Item Variants')).props.onClick();h.flush();assert.doesNotMatch(text(h.tree),/SELLING PRICE|MRP \(₹\)/);assert.match(text(h.tree),/STOCK/);assert.equal(h.find(n=>n.type===Variant).props.allowUnsaved,true);assert.equal(h.find(n=>n.type===Variant).props.eligible,true);}finally{h.close();}
});
test('a late creation response cannot close or erase a newer product draft',async()=>{
  const h=hookHarness(Provider,{},'/seller/products',undefined,{localStorage:storage()});
  try{
    h.tree.props.value.startNewWholesaleProduct();h.flush();const form={...h.tree.props.value.newProductForm,name:'First',categoryId:product.category._id,variants:[{name:'Case',price:0,mrp:0,stock:100,unit:'piece',wholesalePricing:{enabled:true,minimumQuantity:10,quantityIncrement:5,priceTiers:[{minimumQuantity:10,unitPrice:95}]}}]};
    const pending=h.tree.props.value.submitNewProduct(form,[{file:new Blob(['fixture'],{type:'image/png'})}]);
    h.tree.props.value.startNewWholesaleProduct();h.flush();h.tree.props.value.setNewProductForm(f=>({...f,name:'Newer draft'}));h.flush();
    h.requests.find(r=>r.options.method==='POST'&&r.url.endsWith('/api/products')).resolve({product});assert.equal((await pending).stale,true);h.flush();assert.equal(h.tree.props.value.newProductForm.name,'Newer draft');assert.equal(h.tree.props.value.showAddProductModal,true);
  }finally{h.close();}
});
test('profile renders authoritative contacts/status, no fabricated tier, region, hours or identity',()=>{
  const h=hookHarness(Profile,{},'/seller/profile',{sellerProfile:seller,fetchSellerProfile(){},triggerToast(){}},{localStorage:storage()});
  try{const view=text(h.tree);assert.match(view,/Real Owner/);assert.match(view,/Real Store/);assert.match(view,/9876500001/);assert.match(view,/9876500002/);assert.match(view,/owner@example.invalid/);assert.match(view,/store@example.invalid/);assert.match(view,/Unavailable/);assert.doesNotMatch(view,/Amit|Verified Merchant|Pan India|Standard Growth|OPEN NOW|7999810344/);h.click('Edit Profile');assert.ok(h.find(n=>n.type===Editor));}finally{h.close();}
});
test('profile failure and loading are distinct from an empty registration and offer retry',()=>{
  for(const state of [{profileLoading:true},{profileError:'Network unavailable'},{}]){
    let retries=0;const h=hookHarness(Profile,{},'/seller/profile',{...state,fetchSellerProfile(){retries++;}},{localStorage:storage()});
    try{if(state.profileLoading)assert.match(text(h.tree),/Loading seller profile/);else {assert.match(text(h.tree),state.profileError?/Network unavailable/:/No store details/);h.click('Retry profile');assert.equal(retries,2);}}finally{h.close();}
  }
});
test('profile editor prepopulates only supported store fields, validates, locks duplicates and displays errors',async()=>{
  let resolve,calls=0,closed=0;const h=hookHarness(Editor,{seller,onClose(){closed++;}},'/seller/profile',{updateSellerProfile:()=>{calls++;return new Promise(r=>resolve=r);}},{localStorage:storage()});
  try{
    assert.equal(h.find(n=>n.props?.name==='name').props.value,'Real Store');
    assert.ok(h.find(n=>n.type==='input'&&n.props.readOnly));assert.equal(h.find(n=>n.props?.name==='status'),undefined);
    h.find(n=>n.props?.name==='email').props.onChange({target:{value:'bad'}});h.flush();
    await h.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});h.flush();assert.equal(calls,0);assert.match(text(h.tree),/valid email/);
    h.find(n=>n.props?.name==='email').props.onChange({target:{value:'fixed@example.invalid'}});h.flush();
    const submit=h.find(n=>n.type==='form').props.onSubmit;const pending=submit({preventDefault(){}});await submit({preventDefault(){}});assert.equal(calls,1);
    resolve({ok:false,message:'Fixture conflict'});await pending;h.flush();assert.equal(closed,0);assert.match(text(h.tree),/Fixture conflict/);
    const success=submit({preventDefault(){}});resolve({ok:true});await success;assert.equal(closed,1);
  }finally{h.close();}
});
test('provider profile update uses seller credentials, excludes approval fields and refreshes authoritative state',async()=>{
  const h=hookHarness(Provider,{},'/seller/profile',undefined,{localStorage:storage()});
  try{
    h.requests.find(r=>r.url.endsWith('/api/sellers/me')).resolve({seller});await h.settle();
    const before=h.tree.props.value.sellerProfile;
    const pending=h.tree.props.value.updateSellerProfile({name:'Changed',status:'approved',wholesaleChannel:{status:'approved'}});
    const duplicate=await h.tree.props.value.updateSellerProfile({name:'Wrong'});assert.equal(duplicate.ok,false);
    const write=h.requests.find(r=>r.options.method==='PUT'&&r.url.endsWith('/api/sellers/profile'));
    assert.equal(write.options.headers.Authorization,'Bearer seller-fixture');assert.deepEqual(JSON.parse(write.options.body),{name:'Changed',version:0});assert.equal(h.tree.props.value.sellerProfile,before);
    write.resolve({seller:{...seller,storeDetails:{name:'Changed'}}});await h.settle();
    h.requests.findLast(r=>r.url.endsWith('/api/sellers/me')).resolve({seller:{...seller,__v:1,storeDetails:{name:'Changed'}}});await pending;await h.settle();assert.equal(h.tree.props.value.sellerProfile.storeDetails.name,'Changed');
  }finally{h.close();}
});
test('product modes preserve the retail channel and stale list responses cannot replace the latest mode',async()=>{
  const h=hookHarness(Provider,{},'/seller/products',undefined,{localStorage:storage()});
  try{
    const old=h.requests.find(r=>r.url.includes('/api/products/seller/mine'));
    h.tree.props.value.setProductListingMode('wholesale');h.flush();const fresh=h.requests.findLast(r=>r.url.includes('/api/products/seller/mine'));
    assert.doesNotMatch(fresh.url,/type=/);assert.equal(h.tree.props.value.activeMode,'ecommerce');
    old.resolve([{...product,name:'Stale'}]);await h.settle();assert.equal(h.tree.props.value.products.length,0);
    fresh.resolve([product]);await h.settle();assert.equal(h.tree.props.value.products[0].name,product.name);
    h.tree.props.value.setProductListingMode('retail');h.tree.props.value.setActiveMode('quick');h.flush();assert.match(h.requests.findLast(r=>r.url.includes('/api/products/seller/mine')).url,/type=grocery/);
  }finally{h.close();}
});
test('Add Product starts a new draft without carrying an edited product identity, price book or inventory',()=>{
  const h=hookHarness(Provider,{},'/seller/products',undefined,{localStorage:storage()});
  try{
    h.tree.props.value.startEditProduct({...product,variants:[{...product.variants[0],wholesalePricing:{enabled:true}}]});h.flush();
    assert.equal(h.tree.props.value.editingProductId,id);
    h.tree.props.value.startNewProduct();h.flush();
    assert.equal(h.tree.props.value.editingProductId,null);assert.equal(h.tree.props.value.newProductForm.name,'');
    assert.equal(h.tree.props.value.newProductForm.variants[0].price,'');assert.equal(h.tree.props.value.newProductForm.variants[0]._id,undefined);assert.equal(h.tree.props.value.newProductForm.variants[0].wholesalePricing,undefined);
  }finally{h.close();}
});
test('three product modes use existing channels; open editors block mode switches',()=>{
  const h=hookHarness(Modes,{},'/seller/products',{sellerProfile:seller,selectedTypes:['ecommerce','quick'],activeMode:'quick',productListingMode:'retail',showAddProductModal:true},{localStorage:storage()});
  try{assert.match(text(h.tree),/E-Commerce.*Quick Commerce.*Wholesale/);assert.ok(h.find(n=>n.type==='button'&&n.props.disabled));}finally{h.close();}
});
test('the existing Products page renders the Wholesale view when its mode is selected',()=>{
  const h=hookHarness(Products,{},'/seller/products',{products:[],productListingMode:'wholesale',sellerProfile:seller},{localStorage:storage()});
  try{assert.ok(h.find(n=>n.type===Wholesale));}finally{h.close();}
});
test('all three modes retain the same heading, toolbar and shell; Wholesale action opens variant selection',()=>{
  for(const [mode,channel] of [['retail','ecommerce'],['retail','quick'],['wholesale','quick']]){
    const h=hookHarness(Products,{},'/seller/products',{products:[],productListingMode:mode,activeMode:channel,sellerProfile:seller,startNewWholesaleProduct(){}},{localStorage:storage()});
    try{
      assert.equal(h.tree.props.className,'seller-products-page');
      assert.ok(h.find(n=>n.props?.className==='seller-products-toolbar'));
      assert.equal(h.find(n=>n.type==='h1').props.children,'Product List');
      assert.ok(h.find(n=>n.type===Modes));
      const action=h.find(n=>n.props?.className==='seller-products-primary');
      assert.match(text(action),mode==='wholesale'?/Add Product/:/Add New Product/);
      if(mode==='wholesale'){h.click('Add Wholesale Offer to Existing Product');h.flush();assert.ok(h.find(n=>n.type===Selector));}
    }finally{h.close();}
  }
});
test('offer selection excludes digital/inactive/out-of-stock products and opens the exact existing variant once',()=>{
  const row=raw=>({id:raw._id,name:raw.name,raw});let calls=[],closed=0;
  const second={...product.variants[0],_id:'507f1f77bcf86cd799439077',name:'Second pack',sku:'PACK-2'};
  const physical={...product,variants:[...product.variants,second]};
  const products=[row(physical),row({...product,_id:'digital',fulfillmentType:'digital'}),row({...product,_id:'inactive',isActive:false}),row({...product,_id:'empty',variants:[{...second,stock:0}]})];
  const h=hookHarness(Selector,{onClose(){closed++;}},'/seller/products',{products,sellerProfile:seller,startEditProduct(...args){calls.push(args);}},{localStorage:storage()});
  try{
    let selects=[];const collect=node=>{if(!node||typeof node!=='object')return;if(node.type==='select')selects.push(node);[node.props?.children].flat(Infinity).forEach(collect);};collect(h.tree);
    assert.equal([selects[0].props.children].flat(Infinity).filter(n=>n?.type==='option').length,2);
    selects[0].props.onChange({target:{value:id}});h.flush();selects=[];collect(h.tree);
    selects[1].props.onChange({target:{value:second._id}});h.flush();assert.match(text(h.tree),/PACK-2/);
    const submit=h.find(n=>n.type==='form').props.onSubmit;submit({preventDefault(){}});submit({preventDefault(){}});
    assert.equal(calls.length,1);assert.equal(calls[0][0],physical);assert.equal(calls[0][1],second._id);assert.equal(closed,1);
  }finally{h.close();}
});
test('selector provides useful loading, error, empty and suspended states without opening the editor',()=>{
  for(const state of [{productsLoading:true},{productsError:'Fixture API failed'},{},{sellerProfile:{...seller,wholesaleChannel:{status:'suspended'}}}]){
    const h=hookHarness(Selector,{onClose(){}},'/seller/products',{sellerProfile:seller,products:[],startEditProduct(){throw new Error('Must not open');},...state},{localStorage:storage()});
    try{
      assert.match(text(h.tree),state.productsLoading?/Loading eligible/:state.productsError?/Fixture API failed/:state.sellerProfile?/Approved Wholesale access/:/Create or activate/);
      assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,true);
    }finally{h.close();}
  }
});
test('Wholesale-only editor has identity context and terms but no retail price or stock inputs',()=>{
  const h=hookHarness(Modal,{},'/seller/products',{showAddProductModal:true,editingProduct:product,editingProductId:id,wholesaleVariantId:variantId,productListingMode:'wholesale',activeChannel:'ecommerce',sellerProfile:seller,newProductForm:{fulfillmentType:'physical',variants:[...product.variants,{...product.variants[0],_id:'507f1f77bcf86cd799439077',name:'Other'}]},setNewProductForm(){},platformLimits:{}},{localStorage:storage()});
  try{
    assert.ok(h.find(n=>n.props?.role==='dialog'));assert.match(text(h.tree),/Shared available stock/);
    assert.equal(h.find(n=>n.type==='input'),undefined); // Actual terms fields are the reused child component.
    assert.equal(h.find(n=>n.type===Variant).props.variant._id,variantId);
    assert.doesNotMatch(text(h.tree),/SELLING PRICE|WEIGHT \(g\)|VARIANT NAME/);
  }finally{h.close();}
});
test('Wholesale save errors retain the draft and allow a successful retry and refresh',async()=>{
  const context={showAddProductModal:true,editingProduct:product,editingProductId:id,wholesaleVariantId:variantId,productListingMode:'wholesale',activeChannel:'grocery',sellerProfile:seller,newProductForm:{fulfillmentType:'physical',variants:product.variants},setNewProductForm(update){context.newProductForm=update(context.newProductForm);},platformLimits:{},triggerToast(){},applySavedWholesaleTerms(){},fetchMyProducts:async()=>{}};
  const h=hookHarness(Modal,{},'/seller/products',context,{localStorage:storage()});
  try{
    h.find(n=>n.type===Variant).props.onChange(0,()=>({enabled:true,minimumQuantity:10,quantityIncrement:5,priceTiers:[{minimumQuantity:10,unitPrice:95}]}));h.rerender();
    const attempt=h.find(n=>n.props?.children==='Save Wholesale Terms').props.onClick();h.requests.findLast(r=>r.options.method==='PATCH').resolve({message:'Fixture conflict'},409);await attempt;h.flush();
    assert.match(text(h.tree),/Fixture conflict/);assert.equal(h.find(n=>n.type===Variant).props.variant.wholesalePricing.minimumQuantity,10);
    const retry=h.find(n=>n.props?.children==='Save Wholesale Terms').props.onClick();const req=h.requests.findLast(r=>r.options.method==='PATCH');req.resolve({variants:JSON.parse(req.options.body).variants,version:1});await retry;h.flush();assert.match(text(h.tree),/Wholesale terms saved/);
  }finally{h.close();}
});
test('tier controls add aligned quantities and remove a tier without changing variant stock or retail price',()=>{
  let variant={...product.variants[0],wholesalePricing:{enabled:true,minimumQuantity:10,quantityIncrement:5,priceTiers:[{minimumQuantity:10,unitPrice:95}]}};
  const props={variant,index:0,eligible:true,onChange(_index,update){variant={...variant,wholesalePricing:update(variant.wholesalePricing)};props.variant=variant;}};
  const h=hookHarness(Variant,props,'/seller/products',undefined,{localStorage:storage()});
  try{
    h.click('Add quantity tier');h.rerender();assert.equal(variant.wholesalePricing.priceTiers[1].minimumQuantity,15);assert.ok(h.find(n=>n.props?.role==='alert'));
    h.find(n=>n.props?.['aria-label']==='Remove tier 2').props.onClick();h.rerender();assert.equal(variant.wholesalePricing.priceTiers.length,1);assert.equal(variant.price,100);assert.equal(variant.stock,100);
  }finally{h.close();}
});
test('Wholesale list separates API errors, approval states and physical variants from digital products',()=>{
  for(const status of ['pending','approved','suspended']){
    const context={sellerProfile:{...seller,wholesaleChannel:{status}},productsError:'Catalog failed',products:[{id,name:'Digital',raw:{...product,fulfillmentType:'digital'}}]};
    const h=hookHarness(Wholesale,{},'/seller/products',context,{localStorage:storage()});
    try{assert.match(text(h.tree),status==='pending'?/pending review/:status==='suspended'?/suspended/:/Catalog failed/);assert.doesNotMatch(text(h.tree),/No eligible physical products/);}finally{h.close();}
  }
});
test('MOQ, increments, tier boundaries and paise precision receive field-specific validation',()=>{
  const pricing={enabled:true,minimumQuantity:10,quantityIncrement:5,priceTiers:[{minimumQuantity:10,unitPrice:95},{minimumQuantity:50,unitPrice:85}]};
  assert.deepEqual(validate(pricing,100),{});
  for(const change of [{minimumQuantity:0},{minimumQuantity:101},{quantityIncrement:1.5},{priceTiers:[]},{priceTiers:[{minimumQuantity:11,unitPrice:1}]},{priceTiers:[{minimumQuantity:10,unitPrice:1.001}]},{priceTiers:[{minimumQuantity:10,unitPrice:0}]},{priceTiers:[{minimumQuantity:10,unitPrice:95},{minimumQuantity:50,unitPrice:96}]}])assert.ok(Object.keys(validate({...pricing,...change},100)).length);
  assert.deepEqual(validate({enabled:false},0),{});
});
test('Wholesale editor uses the product primary channel and submits only terms with a duplicate lock',async()=>{
  const form={name:product.name,fulfillmentType:'physical',categoryId:product.category._id,variants:product.variants};let saved,refreshes=0;
  const context={showAddProductModal:true,editingProduct:product,editingProductId:id,activeChannel:'ecommerce',productListingMode:'wholesale',sellerProfile:seller,newProductForm:form,setNewProductForm(update){context.newProductForm=typeof update==='function'?update(context.newProductForm):update;},platformLimits:{},triggerToast(){},applySavedWholesaleTerms(...args){saved=args;},fetchMyProducts:async()=>{refreshes++;}};
  const h=hookHarness(Modal,{},'/seller/products',context,{localStorage:storage()});
  try{
    assert.match(h.requests.find(r=>r.url.includes('/api/categories/tree')).url,/type=grocery/);
    const fields=h.find(n=>n.type===Variant).props;fields.onChange(0,()=>({enabled:true,minimumQuantity:10,quantityIncrement:5,priceTiers:[{minimumQuantity:10,unitPrice:95}]}));
    h.rerender();const button=h.find(n=>n.type==='button'&&n.props.children==='Save Wholesale Terms'&&n.props.onClick);
    const pending=button.props.onClick();button.props.onClick();
    const writes=h.requests.filter(r=>r.options.method==='PATCH');assert.equal(writes.length,1);
    const payload=JSON.parse(writes[0].options.body);assert.deepEqual(Object.keys(payload).sort(),['variants','version']);assert.equal(payload.variants[0].variantId,variantId);assert.equal(payload.variants[0].price,undefined);
    writes[0].resolve({variants:payload.variants,version:1});await pending;assert.equal(saved[0],id);assert.equal(refreshes,1);
  }finally{h.close();}
});
test('a late Wholesale save cannot update a newly selected product or show a success toast',async()=>{
  const context={showAddProductModal:true,editingProduct:product,editingProductId:id,activeChannel:'ecommerce',productListingMode:'wholesale',sellerProfile:seller,newProductForm:{name:product.name,fulfillmentType:'physical',categoryId:product.category._id,variants:product.variants},setNewProductForm(update){context.newProductForm=update(context.newProductForm);},platformLimits:{},triggerToast(){throw new Error('Stale success toast');},applySavedWholesaleTerms(){throw new Error('Stale edit replacement');},fetchMyProducts:async()=>{throw new Error('Stale refresh');}};
  const h=hookHarness(Modal,{},'/seller/products',context,{localStorage:storage()});
  try{
    h.find(n=>n.type===Variant).props.onChange(0,()=>({enabled:true,minimumQuantity:10,quantityIncrement:5,priceTiers:[{minimumQuantity:10,unitPrice:95}]}));h.rerender();
    const pending=h.find(n=>n.type==='button'&&n.props.children==='Save Wholesale Terms').props.onClick();
    const old=h.requests.find(r=>r.options.method==='PATCH');
    context.editingProductId='507f1f77bcf86cd799439099';context.editingProduct={...product,_id:context.editingProductId};context.newProductForm={...context.newProductForm,variants:product.variants};h.rerender();
    assert.equal(old.options.signal.aborted,true);old.resolve({variants:JSON.parse(old.options.body).variants,version:1});await pending;
    assert.equal(h.find(n=>n.props?.role==='alert'&&text(n).includes('Stale')),undefined);
  }finally{h.close();}
});
test('notification mutations retain rows on failure and never call approval/order/payment endpoints',async()=>{
  const h=hookHarness(notifications,{autoFetch:true},'/seller/profile',undefined,{localStorage:storage()});
  try{
    h.requests.find(r=>r.url.includes('/api/notifications?page')).resolve({data:[{_id:id,isRead:false,title:'Fixture'}]});await h.settle();
    const pending=h.tree.markAllRead();h.requests.find(r=>r.url.endsWith('/read-all')).resolve({message:'Denied'},403);await pending;await h.settle();assert.equal(h.tree.notifications[0].isRead,false);assert.match(h.tree.error,/Denied/);
    const deletion=h.tree.removeNotification(id);h.requests.find(r=>r.options.method==='DELETE').resolve({message:'Failed'},503);await deletion;await h.settle();assert.equal(h.tree.notifications.length,1);
    assert.ok(h.requests.every(r=>r.url.includes('/api/notifications')));
  }finally{h.close();}
});
