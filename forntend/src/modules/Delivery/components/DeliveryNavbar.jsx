import React from 'react';

export const DeliveryNavbar = ({ activeTab, setActiveTab }) => {
  return (
    <div className="delivery-navbar-bottom">
      <button 
        className={`delivery-nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
        onClick={() => setActiveTab('dashboard')}
      >
        <span className="nav-icon">📡</span>
        <span className="nav-label">Duty</span>
      </button>

      <button
        className={`delivery-nav-item ${activeTab === 'earnings' ? 'active' : ''}`}
        onClick={() => setActiveTab('earnings')}
      >
        <span className="nav-icon">💰</span>
        <span className="nav-label">Earnings</span>
      </button>

      <button
        className={`delivery-nav-item ${activeTab === 'history' ? 'active' : ''}`}
        onClick={() => setActiveTab('history')}
      >
        <span className="nav-icon">🧾</span>
        <span className="nav-label">History</span>
      </button>

      <button
        className={`delivery-nav-item ${activeTab === 'returns' ? 'active' : ''}`}
        onClick={() => setActiveTab('returns')}
      >
        <span className="nav-icon">↩️</span>
        <span className="nav-label">Returns</span>
      </button>

      <button
        className={`delivery-nav-item ${activeTab === 'support' ? 'active' : ''}`}
        onClick={() => setActiveTab('support')}
      >
        <span className="nav-icon">🎧</span>
        <span className="nav-label">Support</span>
      </button>

      <button
        className={`delivery-nav-item ${activeTab === 'profile' ? 'active' : ''}`}
        onClick={() => setActiveTab('profile')}
      >
        <span className="nav-icon">👤</span>
        <span className="nav-label">Profile</span>
      </button>
    </div>
  );
};

export default DeliveryNavbar;
