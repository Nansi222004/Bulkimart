import React from 'react';
import { useUser } from '../context/UserContext';
import { useProducts } from '../hooks/useProducts';
import { MerchandisingCard } from './StorefrontSections';
export default function TopProducts() {
  const { activeMode, setActiveNav } = useUser();
  const { products, loading, error, retry } = useProducts({ type: activeMode === 'quick' ? 'grocery' : 'ecommerce', limit: 8 });
  return <section className="sf-section"><div className="sf-section-heading"><div><span className="sf-eyebrow">FIND YOUR NEXT FAVOURITE</span><h2>Fresh finds for you</h2></div><button className="sf-text-button" onClick={() => setActiveNav('categories')}>Browse all →</button></div>
    {loading ? <div className="sf-product-skeleton" role="status">Loading products…</div> : error ? <p role="alert">Products could not be loaded. <button onClick={retry}>Retry</button></p> : products.length ? <div className="sf-product-rail">{products.map(product => <MerchandisingCard key={product.id} product={product} />)}</div> : <p>Products will appear here as sellers publish them.</p>}
  </section>;
}
