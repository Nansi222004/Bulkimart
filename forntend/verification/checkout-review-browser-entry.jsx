import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import LandmarkImagePicker from '../src/modules/User/components/LandmarkImagePicker';
import WriteReviewPage from '../src/modules/User/pages/WriteReviewPage';
import { BasketItem } from '../src/modules/User/components/BasketGroups';
import '../src/index.css';
import '../src/modules/User/User.css';

window.fixture = { uploads: [], submissions: [], backs: 0 };
localStorage.setItem('userToken', 'local-fixture-token');
window.fetch = async (_url, options = {}) => {
  if (options.method === 'POST') {
    const body = options.body;
    const bytes = (await new Response(body).blob()).size;
    window.fixture.submissions.push({ bytes, comment: body.get('comment'), photos: body.getAll('images').map(file => ({ size: file.size, type: file.type })) });
    return new Response(JSON.stringify({ success: true }), { status: bytes < 1024 * 1024 ? 201 : 413 });
  }
  return new Response(JSON.stringify({ _id: 'fixture', name: 'Fixture product', images: ['/favicon.svg'] }));
};
function Fixture() {
  const [url, setUrl] = useState('');
  if (location.search.includes('review')) return <div className="user-landing-page-container"><div className="product-detail-overlay"><WriteReviewPage productId="fixture" onBack={() => { window.fixture.backs++; }} /></div></div>;
  return <><LandmarkImagePicker value={url} onChange={setUrl} onUpload={async file => {
    window.fixture.uploads.push(file.name); return { ok: true, imageUrl: '/favicon.svg' };
  }} /><BasketItem item={{ name: 'Fixture item', price: 100, qty: 1, stock: 5, available: true }} group={{ channel: 'ecommerce', seller: { name: 'Fixture seller' } }} showStock={false} /></>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
