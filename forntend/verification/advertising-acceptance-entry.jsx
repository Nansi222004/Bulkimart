import React from 'react';
import {createRoot} from 'react-dom/client';
import Workspace from '../src/components/advertising/AdvertisingWorkspace';
import SponsoredCategoryBlock from '../src/components/advertising/SponsoredCategoryBlock';
import FeedbackProvider from '../src/components/feedback/FeedbackProvider';
const context=window.__acceptance;
const customer=location.pathname==='/acceptance/customer';
window.__advertisingAcceptanceCustomer={getDeliveryPoint:()=>null,isWishlisted:()=>false,toggleWishlist:async()=>({ok:true}),
  setSelectedProduct:p=>{document.querySelector('#opened').textContent=p.id;},addToCart:()=>{}};
createRoot(document.getElementById('root')).render(<FeedbackProvider>
  <main style={{maxWidth:1100,margin:'auto'}}>
    <h1>Isolated advertising acceptance</h1><p>Synthetic sessions and catalog; real local advertising API. Provider checkout and paid delivery are disabled.</p>
    {customer?<><SponsoredCategoryBlock channel="ecommerce" categoryId={context.categoryId} organicProducts={[]}/><section id="organic">Organic results remain available</section><output id="opened"/></>
      :<Workspace admin={location.pathname==='/acceptance/admin'}/>}
  </main>
</FeedbackProvider>);
