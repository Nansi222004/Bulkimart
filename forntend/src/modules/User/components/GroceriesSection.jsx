import React, { useState, useEffect } from 'react';
import { useUser } from '../context/UserContext';
import { apiUrl } from '../../../utils/api';
import VegetablesSection from './VegetablesSection';
import MilkSection from './MilkSection';

import groceriesEssentials from '../../../assets/groceries_essentials.jpg';
import productRice from '../../../assets/product_rice.png';
import productHoney from '../../../assets/product_honey.png';
import productMilkBottle from '../../../assets/product_milk_bottle.png';
import categoryPackaged from '../../../assets/category_packaged.png';

// Paper Grocery Bag Header Graphic (Matching Image 2)
const GroceryBagGraphic = () => (
  <div style={{
    position: 'relative',
    width: 95,
    height: 85,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    flexShrink: 0
  }}>
    {/* Plants / Leaves sticking out */}
    <div style={{ position: 'absolute', top: 2, left: 12, width: 22, height: 26, backgroundColor: '#16a34a', borderRadius: '50% 50% 0 50%', transform: 'rotate(-25deg)', zIndex: 1 }}></div>
    <div style={{ position: 'absolute', top: 0, left: 32, width: 20, height: 28, backgroundColor: '#22c55e', borderRadius: '50% 50% 50% 0', transform: 'rotate(15deg)', zIndex: 1 }}></div>
    {/* Milk Carton */}
    <div style={{ position: 'absolute', top: 8, right: 14, width: 22, height: 38, backgroundColor: '#818cf8', borderRadius: 4, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
      <div style={{ width: 10, height: 16, backgroundColor: '#fff', borderRadius: 2 }}></div>
    </div>
    {/* Bag Base */}
    <div style={{ width: 75, height: 52, backgroundColor: '#f59e0b', borderRadius: '6px 6px 12px 12px', zIndex: 3, boxShadow: '0 4px 10px rgba(0,0,0,0.12)', borderTop: '4px solid #d97706', position: 'relative' }}>
      <div style={{ width: '100%', height: 4, backgroundColor: '#b45309', position: 'absolute', top: 6 }}></div>
    </div>
  </div>
);

export const GroceriesSection = () => {
  const { setActiveNav, setSelectedCategoryFilter } = useUser();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // 1. Try to fetch grocery categories flagged to show on home
        let res = await fetch(apiUrl('/api/categories?showOnHome=true&type=grocery'));
        let data = await res.json();
        let list = Array.isArray(data) ? data : [];

        // 2. Fallback: get Level 2 categories of the first Level 1 category
        if (list.length === 0) {
          const treeRes = await fetch(apiUrl('/api/categories/tree?type=grocery'));
          const treeData = await treeRes.json();
          if (Array.isArray(treeData) && treeData.length > 0) {
            list = (treeData[0].children || []).slice(0, 4);
          }
        }

        if (!cancelled) {
          setCategories(list);
        }
      } catch (err) {
        console.error('Error fetching grocery home categories:', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
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
    if (name.includes('essential') || slug.includes('essential')) return groceriesEssentials;
    if (name.includes('rice') || name.includes('cereal') || name.includes('millet') || name.includes('staple') || slug.includes('rice') || slug.includes('staple')) return productRice;
    if (name.includes('honey') || name.includes('dry fruit') || name.includes('nut') || slug.includes('honey') || slug.includes('dry-fruit')) return productHoney;
    if (name.includes('milk') || name.includes('beverage') || name.includes('juice') || name.includes('dairy') || slug.includes('milk') || slug.includes('dairy')) return productMilkBottle;
    return categoryPackaged;
  };

  const handleCategoryClick = (cat) => {
    setSelectedCategoryFilter(cat);
    setActiveNav('categories');
  };

  return (
    <div style={{ padding: '16px 16px 20px 16px', backgroundColor: '#f0fdf4', borderRadius: 16 }}>
      <style dangerouslySetInnerHTML={{__html: `
        .groceries-card-category {
          background-color: #ffffff;
          border: 1.5px solid #a7f3d0;
          border-radius: 18px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 8px 6px;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          box-shadow: 0 2px 4px rgba(0,0,0,0.02);
        }
        .groceries-card-category:hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 16px rgba(16, 185, 129, 0.15);
        }
        .trending-banner-card {
          width: 100%;
          max-width: 180px;
          height: 200px;
          border-radius: 22px;
          overflow: hidden;
          position: relative;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          flex-shrink: 0;
          box-shadow: 0 6px 16px rgba(0,0,0,0.08);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          box-sizing: border-box;
          background-color: #fef3c7;
          margin: 0 auto;
        }
        .trending-banner-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 10px 24px rgba(0,0,0,0.15);
        }
      `}} />

      {/* HEADER ROW WITH GROCERY BAG GRAPHIC */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        padding: '20px 0 16px 0'
      }}>
        <div style={{ textAlign: 'left' }}>
          <h2 style={{ margin: 0, fontSize: 21, fontWeight: 900, color: '#073B78', fontFamily: "'Outfit', sans-serif", letterSpacing: '0.3px' }}>
            GROCERIES AT DOORSTEP
          </h2>
          <p style={{ margin: '2px 0 0 0', fontSize: 13, color: '#166534', fontWeight: 600 }}>
            Shop now and save more!
          </p>
        </div>
        <GroceryBagGraphic />
      </div>

      {/* 4-COLUMN CATEGORY GRID */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 10,
        marginBottom: 28
      }}>
        {loading ? (
          <div style={{ color: '#94a3b8', fontSize: 12, padding: '12px 0', gridColumn: 'span 4', textAlign: 'center' }}>Loading categories...</div>
        ) : (
          categories.map((item) => (
            <div key={item._id || item.id} className="groceries-card-category" onClick={() => handleCategoryClick(item)}>
              <span style={{ fontSize: 10, fontWeight: '800', color: '#073B78', textAlign: 'center', minHeight: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Outfit', sans-serif", lineHeight: 1.2 }}>
                {item.name}
              </span>
              <div style={{ width: '100%', height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 4 }}>
                <img src={getCategoryGraphic(item)} alt={item.name} style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }} />
              </div>
            </div>
          ))
        )}
      </div>

      {/* CATALOG SECTIONS ("Fresh") */}
      <VegetablesSection />
      <div style={{ marginTop: 20 }}>
        <MilkSection />
      </div>
    </div>
  );
};

export default GroceriesSection;
