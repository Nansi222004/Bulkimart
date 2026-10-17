import React from 'react';

export const DeliveryNavbar = ({ activeTab, setActiveTab }) => {
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
