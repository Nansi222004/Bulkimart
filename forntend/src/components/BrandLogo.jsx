import React from 'react';
import bulkimartIcon from '../assets/logo-icon-transparent.png';
import bulkimartLogo from '../assets/Glossy Aqua Bulkimart Shopping Logo.png';
import bulkimartTransparentLogo from '../assets/Bulkimart-logo-transparent.png';

/** One source of truth for the official Bulkimart identity across every portal. */
const BrandLogo = ({ className = '', variant = 'full', portal, transparent = false, alt = 'Bulkimart — Sabse Smart Bulkimart' }) => (
  <div className={`brand-logo brand-logo--${variant} ${className}`.trim()}>
    <img src={variant === 'icon' ? bulkimartIcon : transparent ? bulkimartTransparentLogo : bulkimartLogo} alt={alt} className="brand-logo__image" />
    {portal && <span className="brand-logo__portal">{portal}</span>}
  </div>
);

export default BrandLogo;
