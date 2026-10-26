import React from 'react';
import bulkimartIcon from '../assets/logo-icon-transparent.png';
import bulkimartLogo from '../assets/Glossy Aqua Bulkimart Shopping Logo.png';
import bulkimartTransparentLogo from '../assets/Bulkimart-logo-transparent.png';
import sellerLogo from '../assets/seller logo.jpeg';
import deliveryLogo from '../assets/delievry logo.jpg';

/** One source of truth for the official Bulkimart identity across every portal. */
const BrandLogo = ({ className = '', variant = 'full', portal, audience, transparent = false, alt }) => (
  <div className={`brand-logo brand-logo--${variant} ${['seller', 'delivery'].includes(audience) ? 'brand-logo--partner' : ''} ${className}`.trim()}>
    <img src={audience === 'seller' ? sellerLogo : audience === 'delivery' ? deliveryLogo : variant === 'icon' ? bulkimartIcon : transparent ? bulkimartTransparentLogo : bulkimartLogo}
      alt={alt || (audience === 'seller' ? 'Bulkimart Seller' : audience === 'delivery' ? 'Bulkimart Driver' : 'Bulkimart — Sabse Smart Bulkimart')} className="brand-logo__image" />
    {portal && <span className="brand-logo__portal">{portal}</span>}
  </div>
);

export default BrandLogo;
