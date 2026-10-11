import React from 'react';
import { useUser } from '../context/UserContext';

const CouponsSection = () => {
  const { activeMode } = useUser();
  const coupons = [
    {
      id: 'c1',
      title: '20% OFF on Groceries',
      subtitle: 'Min order ₹500',
      code: 'GROCERY20',
      expiry: 'Valid till 31 Aug 2026',
      color: '#10b981',
      bgColor: '#ecfdf5'
    },
    {
      id: 'c2',
      title: 'Flat ₹100 OFF',
      subtitle: 'On Electronics above ₹999',
      code: 'TECH100',
      expiry: 'Valid till 15 Sep 2026',
      color: '#3b82f6',
      bgColor: '#eff6ff'
    },
    {
      id: 'c3',
      title: 'Buy 2 Get 1 Free',
      subtitle: 'On all SHG Products',
      code: 'SHG3FOR2',
      expiry: 'Valid till 30 Sep 2026',
      color: '#f59e0b',
      bgColor: '#fffbeb'
    },
    {
      id: 'c4',
      title: '30% OFF on Garments',
      subtitle: 'First purchase only',
      code: 'FASHION30',
      expiry: 'Valid till 20 Sep 2026',
      color: '#8b5cf6',
      bgColor: '#f5f3ff'
    },
    {
      id: 'c5',
      title: 'Free Delivery',
      subtitle: 'On orders above ₹299',
      code: 'FREEDEL',
      expiry: 'Valid till 31 Dec 2026',
      color: '#ef4444',
      bgColor: '#fef2f2'
    },
    {
      id: 'c6',
      title: '₹50 Cashback',
      subtitle: 'On Milk & Dairy products',
      code: 'DAIRY50',
      expiry: 'Valid till 15 Aug 2026',
      color: '#06b6d4',
      bgColor: '#ecfeff'
    }
  ];

  return (
    <div className="landing-section-container">
      <div className="section-header">
        <h3 className="section-title">Active Coupons & Offers</h3>
        <button className="view-all-link">View All</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {coupons.map((coupon) => {
          const color = activeMode === 'shop-all'
            ? (coupon.id === 'c3' ? 'var(--brand-orange)' : 'var(--primary)')
            : coupon.color;
          const background = activeMode === 'shop-all'
            ? (coupon.id === 'c3' ? 'var(--brand-orange-light)' : 'var(--primary-light)')
            : coupon.bgColor;
          return (
          <div
            key={coupon.id}
            style={{
              background,
              border: `2px dashed ${color}`,
              borderRadius: 12,
              padding: 16,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            <div style={{ flex: 1 }}>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>
                {coupon.title}
              </h4>
              <p style={{ margin: '4px 0 0 0', fontSize: 11, color: '#64748b' }}>
                {coupon.subtitle}
              </p>
              <p style={{ margin: '6px 0 0 0', fontSize: 10, color: '#94a3b8' }}>
                {coupon.expiry}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div
                style={{
                  background: color,
                  color: '#fff',
                  padding: '6px 12px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 800,
                  fontFamily: 'monospace',
                  marginBottom: 4
                }}
              >
                {coupon.code}
              </div>
              <button
                style={{
                  background: 'none',
                  border: 'none',
                  color,
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: 0
                }}
              >
                Copy Code
              </button>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
};

export default CouponsSection;
