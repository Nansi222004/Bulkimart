import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import SponsoredCategoryBlock from '../src/components/advertising/SponsoredCategoryBlock';
import FeedbackProvider from '../src/components/feedback/FeedbackProvider';
const organic = [{ _id: '507f1f77bcf86cd799439012', name: 'Original first product' }, { _id: '507f1f77bcf86cd799439015', name: 'Original second product' }];
window.__pilotFixtureContext = {
  getDeliveryPoint: () => ({lat:12,lng:77}), isWishlisted: () => false,
  toggleWishlist: async () => ({ok:true}),
  setSelectedProduct: product => { document.querySelector('#opened').textContent = product.id; },
  addToCart: (product, qty, variantId) => { document.querySelector('#added').textContent = `${product.id}:${qty}:${variantId}`; },
};
// Like the category pages: products shown as Sponsored are left out of the list below.
function CategoryPage() {
  const [sponsoredIds, setSponsoredIds] = useState([]);
  return <>
    <SponsoredCategoryBlock channel="ecommerce" categoryId="507f1f77bcf86cd799439011" onShown={setSponsoredIds} />
    <section id="organic"><h2>Organic products</h2>{organic.filter(p => !sponsoredIds.includes(p._id)).map(p => <p key={p._id}>{p.name}</p>)}</section>
  </>;
}
createRoot(document.getElementById('root')).render(<FeedbackProvider><main style={{maxWidth:1000,margin:'auto',padding:12}}>
  <h1>Category pilot browser fixture</h1>
  <CategoryPage />
  <output id="opened"/><output id="added"/>
</main></FeedbackProvider>);
