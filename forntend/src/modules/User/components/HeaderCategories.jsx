import React, { useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { useUser } from '../context/UserContext';
import { useStorefront } from '../context/StorefrontContext';
import { apiUrl } from '../../../utils/api';

function CategoryTabArtwork({ category }) {
  const [failed, setFailed] = useState('');
  const source = category.icon || category.image;
  return source && failed !== source
    ? <img src={source.startsWith('/uploads/') ? apiUrl(source) : source} alt="" width="20" height="20" onError={() => setFailed(source)} />
    : <LayoutGrid size={18} aria-hidden="true" />;
}

export default function HeaderCategories() {
  const { activeSubNav, setActiveSubNav } = useUser();
  const { headerCategories = [] } = useStorefront();
  if (!headerCategories.length) return null;

  return headerCategories.map(category => {
    const active = activeSubNav === category.slug;
    return <button type="button" className={`sub-nav-item-btn header-category-tab${active ? ' active' : ''}`} key={category._id}
      data-category-id={category._id} aria-current={active ? 'page' : undefined}
      onClick={() => setActiveSubNav(category.slug)} title={category.name}>
      <span className="sub-nav-icon sub-nav-icon--category"><CategoryTabArtwork category={category} /></span>
      <span className="sub-nav-label">{category.name}</span>
      {active && <span className="sub-nav-active-line" />}
    </button>;
  });
}
