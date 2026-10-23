import React from 'react';
import { createRoot } from 'react-dom/client';
import SponsoredCategoryBlock from '../src/components/advertising/SponsoredCategoryBlock';
import FeedbackProvider from '../src/components/feedback/FeedbackProvider';
const organicId = '507f1f77bcf86cd799439012';
window.__pilotFixtureContext = {
  getDeliveryPoint: () => ({lat:12,lng:77}), isWishlisted: () => false,
  toggleWishlist: async () => ({ok:true}),
  setSelectedProduct: product => { document.querySelector('#opened').textContent = product.id; },
  addToCart: (product, qty, variantId) => { document.querySelector('#added').textContent = `${product.id}:${qty}:${variantId}`; },
};
createRoot(document.getElementById('root')).render(<FeedbackProvider><main style={{maxWidth:1000,margin:'auto',padding:12}}>
  <h1>Category pilot browser fixture</h1>
  <SponsoredCategoryBlock channel="ecommerce" categoryId="507f1f77bcf86cd799439011" organicProducts={[{_id:organicId}]} />
  <section id="organic"><h2>Organic products</h2><p>Original first product</p><p>Original second product</p></section>
  <output id="opened"/><output id="added"/>
</main></FeedbackProvider>);
