import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import Workspace from '../src/components/advertising/AdvertisingWorkspace';
import SponsoredCategoryBlock from '../src/components/advertising/SponsoredCategoryBlock';
import FeedbackProvider from '../src/components/feedback/FeedbackProvider';
const context=window.__acceptance;
const customer=location.pathname==='/acceptance/customer';
// A category page as the storefront renders it: the page's own category goes to the sponsored block,
// and the page's own product list (here: the lamp in its category) leaves out what is shown as Sponsored.
const categoryId=new URLSearchParams(location.search).get('category')||context.categoryId;
const organic=categoryId===context.otherId?[{_id:context.lampId,name:'Acceptance lamp'}]:[];
window.__advertisingAcceptanceCustomer={getDeliveryPoint:()=>null,isWishlisted:()=>false,toggleWishlist:async()=>({ok:true}),
  setSelectedProduct:p=>{document.querySelector('#opened').textContent=p.id;},addToCart:()=>{}};
function CategoryPage(){
  const [sponsoredIds,setSponsoredIds]=useState([]);
  return <><SponsoredCategoryBlock key={categoryId} channel="ecommerce" categoryId={categoryId} onShown={setSponsoredIds}/>
    <section id="organic">Organic results remain available{organic.filter(p=>!sponsoredIds.includes(p._id)).map(p=><p key={p._id} className="organic-product">{p.name}</p>)}</section><output id="opened"/></>;
}
createRoot(document.getElementById('root')).render(<FeedbackProvider>
  <main style={{maxWidth:1100,margin:'auto'}}>
    <h1>Isolated advertising acceptance</h1><p>Synthetic sessions and catalog; real local advertising API. Provider checkout and paid delivery are disabled.</p>
    {customer?<CategoryPage/>:<Workspace admin={location.pathname==='/acceptance/admin'}/>}
  </main>
</FeedbackProvider>);
