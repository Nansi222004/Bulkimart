import React from 'react';
import {createRoot} from 'react-dom/client';
import {ParcelCustomerEntry} from '../src/components/parcels/ParcelDelivery';
import {CustomerSessionContext} from '../src/utils/customerSession';
import ParcelOperations from '../src/components/parcels/ParcelOperations';
import {HomeServiceEntries} from '../src/components/services/CustomerServices';
for(const key of ['userToken','deliveryToken','adminToken'])localStorage.setItem(key,'synthetic-browser-fixture');
window.__parcelCheckoutOpens=0;
window.Razorpay=class {
  constructor(options){this.options=options;}
  on(){} close(){}
  open(){window.__parcelCheckoutOpens++;if(window.__parcelCheckoutMode==='cancel'){this.options.modal.ondismiss();return;}this.options.handler({razorpay_order_id:'order_browser_fixture',razorpay_payment_id:'pay_browser_fixture',razorpay_signature:'synthetic-not-a-real-signature'});}
};
createRoot(document.getElementById('root')).render(window.location.search.includes('cards=1')?<HomeServiceEntries/>:window.location.pathname.startsWith('/admin')?<ParcelOperations admin/>:window.location.pathname.startsWith('/delivery')?<ParcelOperations/>:<CustomerSessionContext.Provider value={{verified:!window.location.search.includes('guest=1')}}><ParcelCustomerEntry/></CustomerSessionContext.Provider>);
