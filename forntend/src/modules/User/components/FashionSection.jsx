import React, { useState, useEffect } from 'react';
import { useUser } from '../context/UserContext';
import { apiUrl } from '../../../utils/api';

import fashionTshirts from '../../../assets/fashion_tshirts.jpg';
import fashionKurtis from '../../../assets/fashion_kurtis.jpg';
import fashionBottomwear from '../../../assets/fashion_bottomwear.jpg';
import fashionInnerwear from '../../../assets/fashion_innerwear.jpg';
import fashionSlippers from '../../../assets/fashion_slippers.jpg';
import fashionAccessories from '../../../assets/fashion_accessories.jpg';
import fashionMen from '../../../assets/fashion_men.jpg';
import fashionWomen from '../../../assets/fashion_women.jpg';
import fashionKids from '../../../assets/fashion_kids.jpg';

const IndependenceSaleBadge = ({ dates }) => (
  <div style={{
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    width: 86,
    height: 86,
    backgroundImage: 'radial-gradient(circle, #fff 40%, #f0fdf4 100%)',
    border: '2px dashed #166534',
    borderRadius: '50%',
    boxShadow: '0 4px 8px rgba(0,0,0,0.05)',
    transform: 'rotate(-4deg)',
    fontFamily: "'Outfit', sans-serif",
    flexShrink: 0
  }}>
    <span style={{ fontSize: 7, fontWeight: 900, color: '#ea580c', textTransform: 'uppercase', letterSpacing: '0.2px', lineHeight: 1.1 }}>Grand</span>
    <span style={{ fontSize: 8, fontWeight: 950, color: '#1e3a8a', textTransform: 'uppercase', letterSpacing: '0.2px', lineHeight: 1.1 }}>Independence</span>
    <div style={{ backgroundColor: '#dc2626', color: '#fff', fontSize: 8, fontWeight: 900, padding: '2px 6px', borderRadius: 4, transform: 'scale(1.05)', margin: '2px 0', boxShadow: '0 2px 4px rgba(220,38,38,0.15)' }}>
      SALE
    </div>
    <span style={{ fontSize: 7, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>{dates}</span>
  </div>
);

export const FashionSection = () => {
  const { setActiveNav, setSelectedCategoryFilter } = useUser();
  const [basicsItems, setBasicsItems] = useState([]);
  const [storyItems, setStoryItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const homeRes = await fetch(apiUrl('/api/categories?showOnHome=true&type=ecommerce'));
        const homeData = await homeRes.json();
        let homeList = Array.isArray(homeData) ? homeData : [];

        const treeRes = await fetch(apiUrl('/api/categories/tree?type=ecommerce'));
        const treeData = await treeRes.json();
        const tree = Array.isArray(treeData) ? treeData : [];

        const fashionHeader = tree.find(l1 =>
          l1.slug?.includes('clothing') || l1.slug?.includes('fashion') || l1.name?.toLowerCase().includes('clothing') || l1.name?.toLowerCase().includes('fashion')
        );

        let fallbackBasics = [];
        let fallbackStories = [];

        if (fashionHeader) {
          fallbackStories = fashionHeader.children || [];
          fallbackBasics = (fashionHeader.children || []).flatMap(l2 => l2.children || []);
        } else {
          fallbackStories = tree.flatMap(l1 => l1.children || []).slice(0, 3);
          fallbackBasics = tree.flatMap(l1 => (l1.children || []).flatMap(l2 => l2.children || [])).slice(0, 6);
        }

        if (!cancelled) {
          setBasicsItems(homeList.length > 0 ? homeList.slice(0, 6) : fallbackBasics.slice(0, 6));
          setStoryItems(fallbackStories.slice(0, 3));
        }
      } catch (err) {
        console.error('Error fetching fashion categories:', err);
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

  const getBasicsGraphic = (item) => {
    if (item.image) return item.image;
    if (item.icon) return item.icon;
    const name = String(item.name || '').toLowerCase();
    const slug = String(item.slug || '').toLowerCase();
    if (name.includes('tshirt') || name.includes('t-shirt') || slug.includes('t-shirt') || slug.includes('tshirt')) return fashionTshirts;
    if (name.includes('kurti') || name.includes('kurta') || name.includes('saree') || slug.includes('kurti') || slug.includes('saree')) return fashionKurtis;
    if (name.includes('bottom') || name.includes('trouser') || name.includes('pants') || name.includes('jeans') || slug.includes('bottom')) return fashionBottomwear;
    if (name.includes('inner') || slug.includes('inner')) return fashionInnerwear;
    if (name.includes('slipper') || name.includes('footwear') || name.includes('shoe') || slug.includes('slipper')) return fashionSlippers;
    return fashionAccessories;
  };

  const getStoryGraphic = (item) => {
    if (item.image) return item.image;
    if (item.icon) return item.icon;
    const name = String(item.name || '').toLowerCase();
    const slug = String(item.slug || '').toLowerCase();
    if (name.includes('men') || slug.includes('men')) return fashionMen;
    if (name.includes('women') || slug.includes('women') || name.includes('saree') || slug.includes('saree')) return fashionWomen;
    return fashionKids;
  };

  const getStoryOffer = () => 'Explore collection';

  const handleCategoryClick = (cat) => {
    setSelectedCategoryFilter(cat);
  };

  return (
    <div style={{ padding: '16px 16px 20px 16px', backgroundColor: '#fffbeb', borderRadius: 16 }}>
      {/* Styles for hover transitions and layouts */}
      <style dangerouslySetInnerHTML={{__html: `
        .fashion-card-basic {
          background-color: #ffffff;
          border: 1.5px solid var(--primary);
          border-radius: 16px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 0;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          box-shadow: 0 2px 4px rgba(0,0,0,0.02);
        }
        .fashion-card-basic:hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 16px rgba(99, 102, 241, 0.2);
        }
        .fashion-card-story {
          background-color: #ffffff;
          border: 1.5px solid #fed7aa;
          border-radius: 20px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          box-shadow: 0 2px 4px rgba(0,0,0,0.02);
        }
        .fashion-card-story:hover {
          transform: translateY(-4px);
          box-shadow: 0 10px 20px rgba(249, 115, 22, 0.15);
        }
      `}} />

      {/* SECTION 1: EVERYDAY BASICS */}
      <div style={{ 
        display: 'flex', 
        flexWrap: 'wrap',
        gap: 12,
        justifyContent: 'space-between', 
        alignItems: 'center', 
        padding: '24px 0 16px 0'
      }}>
        <div style={{ textAlign: 'left' }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: '#dc2626', fontFamily: "'Outfit', sans-serif" }}>
            Everyday Basics
          </h2>
          <p style={{ margin: '2px 0 0 0', fontSize: 13, color: '#b45309', fontWeight: 600 }}>
            Comfort you can count on!
          </p>
        </div>
        <IndependenceSaleBadge dates="12th-16th Aug" />
      </div>

      {/* 6-Card Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 12,
        marginBottom: 28
      }}>
        {loading ? (
          <div style={{ color: '#94a3b8', fontSize: 12, padding: '12px 0', gridColumn: 'span 3', textAlign: 'center' }}>Loading categories...</div>
        ) : (
          basicsItems.map((item) => (
            <div key={item._id || item.id} className="fashion-card-basic" onClick={() => handleCategoryClick(item)}>
              <div style={{ 
                width: '100%', 
                backgroundColor: '#fff', 
                padding: '8px 4px', 
                textAlign: 'center', 
                borderBottom: '1px solid var(--primary-light)'
              }}>
                <span style={{ fontSize: 11, fontWeight: '800', color: 'var(--primary)', fontFamily: "'Outfit', sans-serif" }}>
                  {item.name}
                </span>
              </div>
              <div style={{ 
                width: '100%', 
                height: 120, 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                backgroundColor: '#fff'
              }}>
                <img 
                  src={getBasicsGraphic(item)} 
                  alt={item.name} 
                  style={{ width: '90%', height: '90%', objectFit: 'contain' }} 
                />
              </div>
            </div>
          ))
        )}
      </div>

      {/* SECTION 2: STYLE FOR EVERY STORY */}
      <div style={{ 
        display: 'flex', 
        flexWrap: 'wrap',
        gap: 12,
        justifyContent: 'space-between', 
        alignItems: 'center', 
        padding: '16px 0 16px 0',
        borderTop: '1.5px dashed #fed7aa'
      }}>
        <div style={{ textAlign: 'left' }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: '#1e3a8a', fontFamily: "'Outfit', sans-serif" }}>
            Style for Every Story
          </h2>
          <p style={{ margin: '2px 0 0 0', fontSize: 13, color: '#475569', fontWeight: 600 }}>
            Fresh looks for him, her & the little ones
          </p>
        </div>
        <IndependenceSaleBadge dates="4th-10th Aug" />
      </div>

      {/* 3-Card Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 12
      }}>
        {loading ? (
          <div style={{ color: '#94a3b8', fontSize: 12, padding: '12px 0', gridColumn: 'span 3', textAlign: 'center' }}>Loading categories...</div>
        ) : (
          storyItems.map((item) => (
            <div key={item._id || item.id} className="fashion-card-story" onClick={() => handleCategoryClick(item)}>
              <div style={{ 
                width: '100%', 
                backgroundColor: '#fff', 
                padding: '8px 4px', 
                textAlign: 'center', 
                borderBottom: '1.5px solid #fed7aa'
              }}>
                <span style={{ fontSize: 11, fontWeight: '800', color: '#1e3a8a', fontFamily: "'Outfit', sans-serif" }}>
                  {item.name}
                </span>
              </div>
              
              <div style={{ 
                width: '100%', 
                height: 150, 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                backgroundColor: '#fff'
              }}>
                <img 
                  src={getStoryGraphic(item)} 
                  alt={item.name} 
                  style={{ width: '90%', height: '90%', objectFit: 'contain' }} 
                />
              </div>

              {/* Offer Footer Bar */}
              <div style={{
                width: '100%',
                backgroundColor: '#f97316',
                padding: '6px 4px',
                textAlign: 'center'
              }}>
                <span style={{ fontSize: 10, fontWeight: '800', color: '#ffffff', fontFamily: "'Outfit', sans-serif", textTransform: 'uppercase' }}>
                  {getStoryOffer(item)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default FashionSection;
