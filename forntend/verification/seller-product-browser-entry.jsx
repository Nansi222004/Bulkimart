import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ProductModal from '../src/modules/Seller/components/ProductModal';
import SellerContext from '../src/modules/Seller/context/SellerContext';
import FeedbackProvider from '../src/components/feedback/FeedbackProvider';
import '../src/index.css';
import '../src/modules/Seller/Seller.css';

function App() {
  const [open, setOpen] = useState(true);
  const [form, setForm] = useState({ name: 'Browser fixture product', desc: '', fulfillmentType: 'physical', returnable: false,
    variants: [{ name: '1 kg', price: 100, mrp: 120, stock: 25, unit: 'kg', weight: 1000 }] });
  const context = { showAddProductModal: open, setShowAddProductModal: setOpen, newProductForm: form, setNewProductForm: setForm,
    activeChannel: 'ecommerce', productListingMode: 'retail', platformLimits: {}, setEditingProductId() {}, triggerToast() {},
    submitNewProduct: async () => { window.fixtureSaves = (window.fixtureSaves || 0) + 1; setOpen(false); return { ok: true }; } };
  window.productFixture = form;
  return <FeedbackProvider><div className="seller-app-container"><SellerContext.Provider value={context}>
    <h1>Product list</h1><ProductModal/>
  </SellerContext.Provider></div></FeedbackProvider>;
}
createRoot(document.getElementById('root')).render(<App/>);
