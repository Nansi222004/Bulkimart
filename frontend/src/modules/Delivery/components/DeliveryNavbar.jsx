import React, { useEffect, useState } from 'react';

// Fields that open the on-screen keyboard.
const TYPING = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file]):not([type=range]), textarea, select, [contenteditable="true"]';

export const DeliveryNavbar = ({ activeTab, setActiveTab }) => {
  // While the rider is typing, the keyboard owns the bottom of the screen; the
  // menu would otherwise sit on top of it and cover the form being filled in.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const update = () => setTyping(Boolean(document.activeElement?.matches?.(TYPING)));
    const later = () => setTimeout(update, 0);
    document.addEventListener('focusin', update); document.addEventListener('focusout', later);
    return () => { document.removeEventListener('focusin', update); document.removeEventListener('focusout', later); };
  }, []);
  if (typing) return null;
  return (
    <nav className="delivery-navbar-bottom" aria-label="Delivery navigation">
      <button 
        aria-current={activeTab === 'dashboard' ? 'page' : undefined}
        className={`delivery-nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
        onClick={() => setActiveTab('dashboard')}
      >
        <span className="nav-icon">📡</span>
        <span className="nav-label">Duty</span>
      </button>

      <button
        aria-current={activeTab === 'earnings' ? 'page' : undefined}
        className={`delivery-nav-item ${activeTab === 'earnings' ? 'active' : ''}`}
        onClick={() => setActiveTab('earnings')}
      >
        <span className="nav-icon">💰</span>
        <span className="nav-label">Earnings</span>
      </button>

      <button
        aria-current={activeTab === 'history' ? 'page' : undefined}
        className={`delivery-nav-item ${activeTab === 'history' ? 'active' : ''}`}
        onClick={() => setActiveTab('history')}
      >
        <span className="nav-icon">🧾</span>
        <span className="nav-label">History</span>
      </button>

      <button
        aria-current={activeTab === 'returns' ? 'page' : undefined}
        className={`delivery-nav-item ${activeTab === 'returns' ? 'active' : ''}`}
        onClick={() => setActiveTab('returns')}
      >
        <span className="nav-icon">↩️</span>
        <span className="nav-label">Returns</span>
      </button>

      <button
        aria-current={activeTab === 'support' ? 'page' : undefined}
        className={`delivery-nav-item ${activeTab === 'support' ? 'active' : ''}`}
        onClick={() => setActiveTab('support')}
      >
        <span className="nav-icon">🎧</span>
        <span className="nav-label">Support</span>
      </button>

      <button
        aria-current={activeTab === 'profile' ? 'page' : undefined}
        className={`delivery-nav-item ${activeTab === 'profile' ? 'active' : ''}`}
        onClick={() => setActiveTab('profile')}
      >
        <span className="nav-icon">👤</span>
        <span className="nav-label">Profile</span>
      </button>
    </nav>
  );
};

export default DeliveryNavbar;
