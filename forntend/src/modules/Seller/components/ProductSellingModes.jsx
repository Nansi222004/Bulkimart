import React from 'react';
import { useSeller } from '../context/SellerContext';

export default function ProductSellingModes() {
  const {activeMode,setActiveMode,productListingMode,setProductListingMode,selectedTypes=[],showAddProductModal,profileLoading,sellerProfile}=useSeller();
  const modes=sellerProfile?.salesChannels?.length ? sellerProfile.salesChannels.map(channel=>channel==='grocery'?'quick':channel) : selectedTypes;
  return <div className="seller-listing-modes" role="group" aria-label="Product selling mode">
    {[['ecommerce','E-Commerce'],['quick','Quick Commerce'],['wholesale','Wholesale (B2B)']].filter(([mode])=>mode==='wholesale'||modes.includes(mode)).map(([mode,label])=><button type="button" key={mode} disabled={showAddProductModal||profileLoading||!sellerProfile} aria-pressed={mode==='wholesale'?productListingMode==='wholesale':productListingMode!=='wholesale'&&activeMode===mode} onClick={()=>{setProductListingMode(mode==='wholesale'?'wholesale':'retail');if(mode!=='wholesale')setActiveMode(mode);}}>{label}</button>)}
  </div>;
}
