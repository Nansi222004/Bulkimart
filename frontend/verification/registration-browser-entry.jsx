import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Auth from '../src/modules/User/pages/AuthPage';
import { UserProvider } from '../src/modules/User/context/UserContext';
import SellerAuth from '../src/modules/Seller/pages/SellerLoginPage';
import SellerContext from '../src/modules/Seller/context/SellerContext';
import DeliveryAuth from '../src/modules/Delivery/pages/DeliveryAuthPage';
import { DeliveryProvider } from '../src/modules/Delivery/context/DeliveryContext';
import '../src/index.css';
import '../src/modules/User/User.css';
import '../src/modules/Seller/Seller.css';
import '../src/modules/Delivery/Delivery.css';
import '../src/styles/AuthPages.css';
const originalFetch = window.fetch;
window.fixturePosts = 0;
window.fetch = (url, options) => { if (options?.method === 'POST') window.fixturePosts++; return originalFetch(url, options); };
function App() {
  const [phone, setPhone] = useState('');
  const portal = new URLSearchParams(location.search).get('portal');
  if (portal === 'seller') return <SellerContext.Provider value={{ sellerPhone: phone, setSellerPhone: setPhone, setOtpSent() {}, setOtpCode() {}, setOtpTimer() {}, sendOtp: async () => ({ ok: true }) }}><SellerAuth mode="register"/></SellerContext.Provider>;
  if (portal === 'delivery') return <DeliveryProvider><DeliveryAuth/></DeliveryProvider>;
  return <UserProvider><Auth/></UserProvider>;
}
createRoot(document.getElementById('root')).render(<App/>);
