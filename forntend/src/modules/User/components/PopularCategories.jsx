import React, { useMemo } from 'react';
import { useUser } from '../context/UserContext';
import { useCategoryTree } from '../hooks/useCategoryTree';

const PopularCategories = () => {
  const { setActiveNav, activeMode, setSelectedCategoryFilter } = useUser();
  const type = activeMode === 'quick' ? 'grocery' : 'ecommerce';
  const { tree, loading, error, retry } = useCategoryTree(type);

  const categories = useMemo(() => {
    const flatten = (nodes) => (nodes || []).flatMap((category) => [category, ...flatten(category.children)]);
    const visible = flatten(tree).filter((category) => !category.isSystem);
    const promoted = visible.filter((category) => category.isPopular || category.showOnHome);
    const roots = (tree || []).filter((category) => !category.isSystem);
    return [...(promoted.length ? promoted : (roots.length ? roots : visible))].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).slice(0, 12);
  }, [tree]);

  // Render specific SVG graphics for each circular category matching the design
  const renderCategoryImage = (category) => {
    if (category.image && !category.image.toLowerCase().endsWith('.svg')) {
      return (
        <img
          src={category.image}
          alt={category.name}
          className="category-photo-fill"
        />
      );
    }
    const iconUrl = category.icon || category.image;
    if (iconUrl) {
      return (
        <img
          src={iconUrl}
          alt={category.name}
          className="category-icon-contain"
        />
      );
    }

    const name = String(category.name || '').toLowerCase();
    const slug = String(category.slug || '').toLowerCase();

    if (name.includes('grocery') || slug.includes('grocery')) {
      return (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <rect x="6" y="8" width="12" height="12" rx="2" fill="#dbeafe" stroke="#2563eb" strokeWidth="1.5" />
          <rect x="8" y="5" width="8" height="3" rx="1" fill="#1e40af" />
          <circle cx="10" cy="12" r="1.5" fill="#f59e0b" />
          <circle cx="14" cy="13" r="1" fill="#10b981" />
          <circle cx="12" cy="16" r="1.5" fill="#ef4444" />
        </svg>
      );
    }
    if (name.includes('organic') || slug.includes('organic')) {
      return (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" fill="#d1fae5" />
          <path d="M12 7c-2 0-5 1.5-5 4.5s2 4.5 5 4.5 5-1.5 5-4.5S14 7 12 7z" fill="#10b981" />
          <path d="M12 7V5c0 0 2-1 3 0s-1 2-1 2" stroke="#047857" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    }
    if (name.includes('handmade') || name.includes('craft') || slug.includes('handmade') || slug.includes('craft')) {
      return (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path d="M12 3v18" stroke="#b45309" strokeWidth="1.5" strokeDasharray="2 2" />
          <path d="M7 10c0-2.5 1.5-3 5-3s5 .5 5 3c0 4-2 6-2 9H9s-2-5-2-9z" fill="#ffedd5" stroke="#d97706" strokeWidth="1.5" />
          <ellipse cx="12" cy="7" rx="3" ry="1" fill="#d97706" />
        </svg>
      );
    }
    if (name.includes('spice') || slug.includes('spice')) {
      return (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path d="M4 14c0 3 3 5 8 5s8-2 8-5H4z" fill="#fef3c7" stroke="#d97706" strokeWidth="1.5" />
          <path d="M6 14c0-2 2-3 6-3s6 1 6 3H6z" fill="#ea580c" />
          <circle cx="12" cy="9" r="2" fill="#e11d48" />
          <circle cx="8" cy="11" r="1.5" fill="#ca8a04" />
        </svg>
      );
    }
    if (name.includes('pickle') || slug.includes('pickle')) {
      return (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <rect x="7" y="10" width="10" height="10" rx="2" fill="#fff" stroke="#d97706" strokeWidth="1.5" />
          <path d="M7 10h10v4H7v-4z" fill="#ea580c" />
          <rect x="9" y="6" width="6" height="4" rx="1" fill="#facc15" stroke="#ca8a04" strokeWidth="1" />
        </svg>
      );
    }

    // Default icon
    return (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
        <path d="M9 12h6M12 9v6" />
      </svg>
    );
  };

  const handleCategoryClick = (category) => {
    setSelectedCategoryFilter(category);
  };

  return (
    <div className="popular-categories-container">
      <div className="section-header">
        <h3 className="section-title">Popular Categories</h3>
        <button type="button" className="popular-categories-view-all" onClick={() => setActiveNav('categories')}>View All</button>
      </div>

      <div className="categories-scroll-wrapper">
        {loading ? (
          <div style={{ color: '#94a3b8', fontSize: 12, padding: '10px 12px' }}>Loading...</div>
        ) : error ? (
          <div className="inline-section-state" role="alert">
            <span>Categories unavailable.</span>
            <button type="button" onClick={retry}>Retry</button>
          </div>
        ) : categories.length === 0 ? (
          <div className="inline-section-state">No customer categories are published yet.</div>
        ) : (
          categories.map((category) => (
            <button type="button"
              key={category._id || category.id} 
              className="category-scroll-item"
              onClick={() => handleCategoryClick(category)}
            >
              <div className="category-circle-wrapper">
                {renderCategoryImage(category)}
              </div>
              <span className="category-name">{category.name}</span>
            </button>
          ))
        )}

      </div>
    </div>
  );
};

export default PopularCategories;
