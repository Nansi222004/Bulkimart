import React, { useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { useUser } from '../context/UserContext';
import { useStorefront } from '../context/StorefrontContext';
import { apiUrl } from '../../../utils/api';

// A picked icon is a line drawing, tinted to match the header; a custom image is a picture,
// shown in its own colours as a small round thumbnail.
const artworkOf = category => category.icon ? { source: category.icon, photo: false } : { source: category.image, photo: !!category.image };

function CategoryTabArtwork({ source }) {
  const [failed, setFailed] = useState('');
  return source && failed !== source
    ? <img src={source.startsWith('/uploads/') ? apiUrl(source) : source} alt="" width="20" height="20" onError={() => setFailed(source)} />
    : <LayoutGrid size={18} aria-hidden="true" />;
}

export default function HeaderCategories() {
  const { activeSubNav, setActiveSubNav } = useUser();
  const { headerCategories = [] } = useStorefront();
  if (!headerCategories.length) return null;

  return headerCategories.map(category => {
    const active = activeSubNav === category.slug, artwork = artworkOf(category);
    return <button type="button" className={`sub-nav-item-btn header-category-tab${active ? ' active' : ''}`} key={category._id}
      data-category-id={category._id} aria-current={active ? 'page' : undefined}
      onClick={() => setActiveSubNav(category.slug)} title={category.name}>
      <span className={`sub-nav-icon sub-nav-icon--category${artwork.photo ? ' sub-nav-icon--photo' : ''}`}><CategoryTabArtwork source={artwork.source} /></span>
      <span className="sub-nav-label">{category.name}</span>
      {active && <span className="sub-nav-active-line" />}
    </button>;
  });
}
