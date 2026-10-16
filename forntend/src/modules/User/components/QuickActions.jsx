import React, { useEffect, useState } from 'react';
import { QUICK_ACTIONS } from '../constants';
import { useUser } from '../context/UserContext';
import { apiUrl } from '../../../utils/api';
import { boundedFetch } from '../../../utils/portalRequests';

const QuickActions = () => {
  const { setActiveNav, activeMode } = useUser();
  const [wholesaleAvailable, setWholesaleAvailable] = useState(false);
  const [wholesaleError, setWholesaleError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setWholesaleError(false);
    boundedFetch(apiUrl('/api/products/wholesale/availability'), { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Wholesale availability could not be checked.');
        const data = await response.json();
        if (data?.success !== true || typeof data.enabled !== 'boolean') throw new Error('Invalid availability response');
        if (!controller.signal.aborted) setWholesaleAvailable(data.enabled);
      })
      .catch(() => { if (!controller.signal.aborted) { setWholesaleAvailable(false); setWholesaleError(true); } });
    return () => controller.abort();
  }, [attempt]);

  // Render specific SVG icons based on icon name
  const renderIcon = (iconName, color) => {
    switch (iconName) {
      case 'scooter':
        return (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="5" cy="18" r="3"></circle>
            <circle cx="19" cy="18" r="3"></circle>
            <path d="M12 18V8h6a4 4 0 0 1 4 4v3"></path>
            <line x1="8" y1="18" x2="16" y2="18"></line>
            <polyline points="10 5 12 8 16 8"></polyline>
          </svg>
        );
      case 'bag':
        return (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <path d="M16 10a4 4 0 0 1-8 0"></path>
          </svg>
        );
      case 'store':
        return (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 9l3-6h14l3 6v1a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-3-1V9z"></path>
            <path d="M4 10v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V10"></path>
            <path d="M9 22V12h6v10"></path>
          </svg>
        );
      case 'grid':
        return (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="2.2"></rect>
            <rect x="14" y="3" width="7" height="7" rx="2.2"></rect>
            <rect x="14" y="14" width="7" height="7" rx="2.2"></rect>
            <rect x="3" y="14" width="7" height="7" rx="2.2"></rect>
          </svg>
        );
      case 'bulk':
        return (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m3 7 9-4 9 4-9 4-9-4Z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /><path d="m7.5 5 9 4" />
          </svg>
        );
      case 'ticket':
        return (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
            <line x1="7" y1="7" x2="7.01" y2="7"></line>
          </svg>
        );
      default:
        return null;
    }
  };

  const handleActionClick = (actionId) => {
    if (actionId === 'categories') {
      setActiveNav('categories');
    } else if (actionId === 'offers') {
      setActiveNav('home');
    } else if (actionId === 'wholesale') {
      setActiveNav('wholesale');
    }
  };

  return (
    <>
    <div className="quick-actions-container">
      {QUICK_ACTIONS.filter((action) => action.id !== 'wholesale' || wholesaleAvailable).map((action) => (
        <div 
          key={action.id} 
          className={`quick-action-card ${activeMode === 'shop-all' ? 'quick-action-card--shop-all' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => handleActionClick(action.id)}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') handleActionClick(action.id); }}
        >
          <div
            className="action-icon-wrapper"
            style={{ backgroundColor: activeMode === 'shop-all' ? 'var(--quick-action-icon-bg, var(--primary-light))' : action.color }}
          >
            {renderIcon(action.icon, activeMode === 'shop-all' && action.id !== 'offers' ? 'var(--quick-action-icon-color, var(--primary-hover))' : action.iconColor)}
          </div>
          <div className="action-text">
            <span className="action-title">{action.title}</span>
            <span className="action-subtitle">{action.subtitle}</span>
          </div>
        </div>
      ))}
    </div>
    {wholesaleError && <p role="alert">Wholesale availability could not be checked. <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry wholesale availability</button></p>}
    </>
  );
};

export default QuickActions;
