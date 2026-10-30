import CategoryArtwork from './CategoryArtwork';
import React, { useState, useEffect } from 'react';
import { useUser } from '../context/UserContext';
import { apiUrl } from '../../../utils/api';


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





  const getStoryOffer = () => 'Explore collection';

  const handleCategoryClick = (cat) => {
    setSelectedCategoryFilter(cat);
  };

  return (
    <div style={{ padding: '16px 16px 20px 16px', backgroundColor: 'var(--sf-highlight)', borderRadius: 16 }}>
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
          border: 1.5px solid var(--sf-category-frame);
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
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: 'var(--sf-primary)', fontFamily: 'inherit' }}>
            Everyday Basics
          </h2>
          <p style={{ margin: '2px 0 0 0', fontSize: 13, color: 'var(--sf-muted)', fontWeight: 600 }}>
            Comfort you can count on!
          </p>
        </div>

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
                <span style={{ fontSize: 11, fontWeight: '800', color: 'var(--primary)', fontFamily: 'inherit' }}>
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
                <CategoryArtwork category={item} />
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
        borderTop: '1.5px dashed var(--sf-category-frame)'
      }}>
        <div style={{ textAlign: 'left' }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: 'var(--sf-text)', fontFamily: 'inherit' }}>
            Style for Every Story
          </h2>
          <p style={{ margin: '2px 0 0 0', fontSize: 13, color: '#475569', fontWeight: 600 }}>
            Fresh looks for him, her & the little ones
          </p>
        </div>

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
                borderBottom: '1.5px solid var(--sf-category-frame)'
              }}>
                <span style={{ fontSize: 11, fontWeight: '800', color: 'var(--sf-text)', fontFamily: 'inherit' }}>
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
                <CategoryArtwork category={item} />
              </div>

              {/* Offer Footer Bar */}
              <div style={{
                width: '100%',
                backgroundColor: 'var(--sf-action)',
                padding: '6px 4px',
                textAlign: 'center'
              }}>
                <span style={{ fontSize: 10, fontWeight: '800', color: 'var(--sf-action-text)', fontFamily: 'inherit', textTransform: 'uppercase' }}>
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
