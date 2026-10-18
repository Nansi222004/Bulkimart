import { useEffect, useState } from 'react';
import { boundedFetch } from '../../../utils/portalRequests';
import { captureUserSession, isCurrentUserSession } from '../../../utils/userSession';
import { apiUrl } from '../../../utils/api';
import { normalizeProduct } from './useProducts';
import { wholesaleDetailProduct } from '../utils/productRoute';

export function useWholesaleRecommendations(enabled, productId) {
  const token = localStorage.getItem('userToken');
  const key = `${productId}:${token}`;
  const [result,setResult]=useState(null);
  useEffect(()=>{
    if(!enabled)return;
    let active=true;const controller=new AbortController(),session=captureUserSession();
    boundedFetch(apiUrl('/api/products/wholesale/catalog?limit=12'),{signal:controller.signal,cache:'no-store'})
      .then(async response=>{const body=await response.json();if(!response.ok)throw new Error();if(active&&isCurrentUserSession(session))setResult({key,products:(body.data || []).filter(p=>String(p._id)!==String(productId)).map(p=>({...normalizeProduct(wholesaleDetailProduct(p)),startingPrice:Math.min(...p.variants.map(v=>v.startingPrice)),variantId:p.variants[0]?.variantId}))});})
      .catch(()=>{if(active)setResult({key,products:[]});});
    return()=>{active=false;controller.abort();};
  },[enabled,key]);
  return enabled && result?.key===key ? result.products : [];
}
