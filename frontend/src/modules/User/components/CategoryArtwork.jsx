import React, { useState } from 'react';
import { useStorefront } from '../context/StorefrontContext';
import StorefrontMedia from './StorefrontMedia';
import { apiUrl } from '../../../utils/api';

export default function CategoryArtwork({ category }) {
  const { theme, device } = useStorefront();
  const [failed, setFailed] = useState('');
  const tile = theme?.categoryTiles?.find(item => item.categoryId === String(category._id || category.id));
  const image = category.image || category.icon;
  return <>
    {tile ? <StorefrontMedia banner={tile.banner} device={device} active={false} /> : image && failed !== image ?
      <img src={image.startsWith('/uploads/') ? apiUrl(image) : image} alt={category.name} loading="lazy" className="is-photo" onError={() => setFailed(image)} /> :
      <span className="all-category-fallback" aria-hidden="true">{category.name?.slice(0, 1) || '◆'}</span>}
    {tile?.badge && <span className="sf-category-badge">{tile.badge}</span>}
  </>;
}
