import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import LandmarkImagePicker from '../src/modules/User/components/LandmarkImagePicker';
import WriteReviewPage from '../src/modules/User/pages/WriteReviewPage';
import DeliveryPartnerRating from '../src/modules/User/components/DeliveryPartnerRating';
import { BasketItem } from '../src/modules/User/components/BasketGroups';
import '../src/index.css';
import '../src/modules/User/User.css';

window.fixture = { uploads: [], submissions: [], backs: 0 };
localStorage.setItem('userToken', 'local-fixture-token');
window.fetch = async (_url, options = {}) => {
  if (String(_url).includes('/delivery-rating')) {
    const { rating } = JSON.parse(options.body);
    window.fixture.deliveryRating = rating;
    return new Response(JSON.stringify({ data: { rating } }));
  }
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
  const [deliveryRating, setDeliveryRating] = useState(null);
  if (location.search.includes('rating')) return <div className="user-landing-page-container">
    <div className="product-detail-overlay"><DeliveryPartnerRating orderId="fixture" riderName="Fixture rider"
      deliveryRating={{ eligible: true, rating: deliveryRating }} onRated={setDeliveryRating} /></div>
    <nav className="bottom-nav-bar"><button>Home</button><button>Categories</button><button>Orders</button><button>Profile</button></nav>
  </div>;
  if (location.search.includes('review')) return <div className="user-landing-page-container"><div className="product-detail-overlay"><WriteReviewPage productId="fixture" onBack={() => { window.fixture.backs++; }} /></div></div>;
  return <><LandmarkImagePicker value={url} onChange={setUrl} onUpload={async file => {
    window.fixture.uploads.push({ name: file.name, type: file.type, size: file.size }); return { ok: true, imageUrl: '/favicon.svg' };
  }} /><BasketItem item={{ name: 'Fixture item', price: 100, qty: 1, stock: 5, available: true }} group={{ channel: 'ecommerce', seller: { name: 'Fixture seller' } }} showStock={false} /></>;
}
const root = createRoot(document.getElementById('root'));
window.fixture.unmount = () => root.unmount();
root.render(<Fixture />);
