import React, { useState, useEffect } from 'react';
import { useUser } from '../context/UserContext';
import { useProducts } from '../hooks/useProducts';
import { formatCurrency } from '../utils/helpers';
import { useDeliveryOptions } from '../hooks/useDeliveryOptions';
import { SameDayBadge } from './SameDayBadge';
import { apiUrl } from '../../../utils/api';
import WishlistHeartButton from './WishlistHeartButton';

import productSolarCharger from '../../../assets/product_solar_charger.png';
import productEmergencyBulb from '../../../assets/product_emergency_bulb.png';
import productRechargeableTorch from '../../../assets/product_rechargeable_torch.png';
import productSolarDeskFan from '../../../assets/product_solar_desk_fan.png';
import productSolarLantern from '../../../assets/product_solar_lantern.png';

export const ElectronicsSection = () => {
  const { addToCart, setSelectedProduct, setActiveNav, getDeliveryPoint, setSelectedCategoryFilter } = useUser();
  // live listings — replaces the old hardcoded demo array
  const { products, loading } = useProducts({ type: 'ecommerce', limit: 6 });

  // One batched verdict for the whole strip — see SameDayBadge for why the
  // badge is hidden until the server has actually said yes.
  const { options } = useDeliveryOptions(products.map((p) => p.id), getDeliveryPoint());

  const [categories, setCategories] = useState([]);
  const [loadingCategories, setLoadingCategories] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingCategories(true);
      try {
        // 1. Try to fetch ecommerce categories flagged to show on home
        let res = await fetch(apiUrl('/api/categories?showOnHome=true&type=ecommerce'));
        let data = await res.json();
        let list = Array.isArray(data) ? data : [];

        // 2. Fallback: get children of Solar & Utilities (or similar) from tree
        if (list.length === 0) {
          const treeRes = await fetch(apiUrl('/api/categories/tree?type=ecommerce'));
          const treeData = await treeRes.json();
          if (Array.isArray(treeData)) {
            const electronicsHeader = treeData.find(l1 => 
              l1.slug?.includes('solar') || l1.slug?.includes('appliance') || l1.name?.toLowerCase().includes('solar')
            );
            if (electronicsHeader && electronicsHeader.children) {
              list = electronicsHeader.children.slice(0, 8);
            } else {
              list = treeData.flatMap(l1 => l1.children || []).slice(0, 8);
            }
          }
        }

        if (!cancelled) {
          setCategories(list);
        }
      } catch (err) {
        console.error('Error fetching electronics categories:', err);
      } finally {
        if (!cancelled) {
          setLoadingCategories(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const getCategoryGraphic = (cat) => {
    if (cat.image) return cat.image;
    if (cat.icon) return cat.icon;
    const name = String(cat.name || '').toLowerCase();
    const slug = String(cat.slug || '').toLowerCase();
    if (name.includes('charger') || slug.includes('charger')) return productSolarCharger;
    if (name.includes('bulb') || name.includes('light') || slug.includes('bulb') || slug.includes('light')) return productEmergencyBulb;
    if (name.includes('torch') || slug.includes('torch')) return productRechargeableTorch;
    if (name.includes('fan') || slug.includes('fan')) return productSolarDeskFan;
    if (name.includes('lantern') || slug.includes('lantern')) return productSolarLantern;
    return productSolarCharger;
  };

  const getCategoryPriceInfo = (cat) => {
    const name = String(cat.name || '').toLowerCase();
    if (name.includes('smartphone') || name.includes('phone')) return 'From ₹552/month*';
    if (name.includes('accessory')) return 'Upto 80% Off';
    if (name.includes('juicer') || name.includes('blender') || name.includes('appliance')) return 'From ₹499';
    return 'From ₹299';
  };

  const handleCategoryClick = (cat) => {
    setSelectedCategoryFilter(cat);
    setActiveNav('categories');
  };

  return (
    <div style={{ padding: '16px 16px 20px 16px', backgroundColor: '#f5f3ff', borderRadius: 16 }}>
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes electronicsFloatyBob {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-6px); }
          100% { transform: translateY(0px); }
        }
        .electronics-card-category {
          background-color: #ffffff;
          border: 1.5px solid #e9d5ff;
          border-radius: 22px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 10px 4px 8px 4px;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          box-shadow: 0 2px 6px rgba(126, 34, 206, 0.04);
        }
        .electronics-card-category:hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 18px rgba(147, 51, 234, 0.18);
        }
        .floaty-icon-1 {
          animation: electronicsFloatyBob 3s ease-in-out infinite;
        }
        .floaty-icon-2 {
          animation: electronicsFloatyBob 3.5s ease-in-out infinite 0.4s;
        }
        .floaty-icon-3 {
          animation: electronicsFloatyBob 3.2s ease-in-out infinite 0.2s;
        }
        .floaty-icon-4 {
          animation: electronicsFloatyBob 3.8s ease-in-out infinite 0.6s;
        }
      `}} />

      {/* 3D PEDESTAL & FINGERTIPS HEADER */}
      <div style={{ 
        position: 'relative',
        padding: '28px 12px 24px 12px',
        textAlign: 'center',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundImage: 'repeating-linear-gradient(45deg, rgba(233,213,255,0.3) 0px, rgba(233,213,255,0.3) 12px, transparent 12px, transparent 24px)',
        borderRadius: 24,
        marginBottom: 16,
        overflow: 'hidden'
      }}>
        {/* Left Side Pedestal & Devices (Mouse + Keyboard) */}
        <div style={{ position: 'absolute', left: 8, bottom: 6, display: 'flex', alignItems: 'flex-end', gap: 6 }}>
          {/* Mouse Pedestal */}
          <div className="floaty-icon-1" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ backgroundColor: '#fff', padding: '6px 8px', borderRadius: 14, boxShadow: '0 4px 10px rgba(0,0,0,0.06)', border: '1px solid #e9d5ff' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7e22ce" strokeWidth="2.5"><rect x="6" y="3" width="12" height="18" rx="6"/><line x1="12" y1="7" x2="12" y2="11"/></svg>
            </div>
            <div style={{ width: 28, height: 12, backgroundColor: '#edd8ff', borderRadius: '50%', marginTop: 2, boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}></div>
          </div>
          {/* Keyboard Pedestal */}
          <div className="floaty-icon-2" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ backgroundColor: '#fff', padding: '6px 8px', borderRadius: 12, boxShadow: '0 4px 10px rgba(0,0,0,0.06)', border: '1px solid #e9d5ff' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7e22ce" strokeWidth="2.5"><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="10" x2="6" y2="10"/><line x1="10" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="14" y2="10"/><line x1="18" y1="10" x2="18" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/></svg>
            </div>
            <div style={{ width: 34, height: 14, backgroundColor: '#e9d5ff', borderRadius: '50%', marginTop: 2, boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}></div>
          </div>
        </div>

        {/* Center Title */}
        <div style={{ zIndex: 2, padding: '0 60px' }}>
          <h2 style={{ 
            margin: 0, 
            fontSize: 19, 
            fontWeight: 950, 
            color: '#4c1d95', 
            fontFamily: "'Outfit', sans-serif", 
            letterSpacing: '0.5px',
            textShadow: '0 2px 4px rgba(255,255,255,0.8)' 
          }}>
            ELECTRONICS AT FINGER TIPS
          </h2>
        </div>

        {/* Right Side Pedestal & Devices (Gamepad + Phone) */}
        <div style={{ position: 'absolute', right: 8, bottom: 6, display: 'flex', alignItems: 'flex-end', gap: 6 }}>
          {/* Gamepad Pedestal */}
          <div className="floaty-icon-3" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ backgroundColor: '#fff', padding: '6px 8px', borderRadius: 14, boxShadow: '0 4px 10px rgba(0,0,0,0.06)', border: '1px solid #e9d5ff' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7e22ce" strokeWidth="2.5"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><circle cx="15" cy="13" r="1"/><circle cx="18" cy="11" r="1"/><rect x="2" y="6" width="20" height="12" rx="6"/></svg>
            </div>
            <div style={{ width: 32, height: 13, backgroundColor: '#edd8ff', borderRadius: '50%', marginTop: 2, boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}></div>
          </div>
          {/* Phone Pedestal */}
          <div className="floaty-icon-4" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ backgroundColor: '#fff', padding: '6px 8px', borderRadius: 12, boxShadow: '0 4px 10px rgba(0,0,0,0.06)', border: '1px solid #e9d5ff' }}>
              <svg width="18" height="20" viewBox="0 0 24 24" fill="none" stroke="#7e22ce" strokeWidth="2.5"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
            </div>
            <div style={{ width: 28, height: 12, backgroundColor: '#e9d5ff', borderRadius: '50%', marginTop: 2, boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}></div>
          </div>
        </div>
      </div>

      {/* 8 CATEGORY CARDS GRID (4 cols x 2 rows) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 10,
        marginBottom: 32
      }}>
        {loadingCategories ? (
          <div style={{ color: '#94a3b8', fontSize: 12, padding: '12px 0', gridColumn: 'span 4', textAlign: 'center' }}>Loading categories...</div>
        ) : (
          categories.map((item) => (
            <div key={item._id || item.id} className="electronics-card-category" onClick={() => handleCategoryClick(item)}>
              <span style={{ fontSize: 11, fontWeight: '900', color: '#4c1d95', textAlign: 'center', minHeight: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Outfit', sans-serif", lineHeight: 1.1 }}>
                {item.name}
              </span>
              <div style={{ width: '100%', height: 75, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '4px 0' }}>
                <img src={getCategoryGraphic(item)} alt={item.name} style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain', mixBlendMode: 'multiply' }} />
              </div>
              <span style={{ fontSize: 9, fontWeight: '800', color: '#581c87', backgroundColor: '#f3e8ff', padding: '3px 8px', borderRadius: 10, border: '1px solid #e9d5ff' }}>
                {getCategoryPriceInfo(item)}
              </span>
            </div>
          ))
        )}
      </div>

      {/* BEST OF GADGETS PRODUCT CATALOG */}
      <div>
        <h3 style={{ margin: '0 0 16px 0', fontSize: 18, fontWeight: 900, color: '#3b0764', textAlign: 'left', fontFamily: "'Outfit', sans-serif" }}>
          Best of Gadgets
        </h3>

        <div className="section-products-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          {products.map((product) => (
            <div
              key={product.id}
              className="grid-product-card"
              style={{ backgroundColor: '#ffffff', borderRadius: 18, padding: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', cursor: 'pointer', border: '1px solid #f3e8ff' }}
              onClick={() => setSelectedProduct(product)}
            >
              <div className="grid-product-img-wrapper" style={{ height: 110, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                <img
                  src={product.image}
                  alt={product.name}
                  className="grid-product-img"
                  style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }}
                />
                <WishlistHeartButton productId={product.id} size={14} style={{ position: 'absolute', top: 0, right: 0 }} />
              </div>
              <div className="grid-product-details" style={{ textAlign: 'left' }}>
                <h4 className="grid-product-name" style={{ margin: '0 0 4px 0', fontSize: 12, fontWeight: 800, color: '#1e293b' }}>{product.name}</h4>
                <span className="grid-product-shg" style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 8 }}>{product.shg}</span>
                <SameDayBadge verdict={options[product.id]?.sameDay} compact />

                <div className="grid-product-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="grid-product-price" style={{ fontSize: 13, fontWeight: 900, color: '#7e22ce' }}>
                    {formatCurrency(product.price)}
                  </span>
                  <button
                    className="grid-product-add-btn"
                    style={{ backgroundColor: '#7e22ce', color: '#fff', border: 'none', borderRadius: 8, padding: '4px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      addToCart(product);
                    }}
                    aria-label={`Add ${product.name} to cart`}
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ElectronicsSection;
