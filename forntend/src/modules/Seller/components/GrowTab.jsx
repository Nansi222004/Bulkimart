import React from 'react';
import { useSeller } from '../context/SellerContext';

export const GrowTab = () => {
  const {
    activeGrowTab,
    setActiveGrowTab,
    campaigns,
    handleStartCampaign,
    triggerToast
  } = useSeller();

  return (
    <>
      <div className="seller-scroll-tabs">
        {['Overview', 'Promote', 'Client Brand'].map(gTab => (
          <button 
            key={gTab}
            className={`seller-tab-btn ${activeGrowTab === gTab ? 'active' : ''}`}
            onClick={() => setActiveGrowTab(gTab)}
          >
            {gTab}
          </button>
        ))}
      </div>

      {activeGrowTab === 'Overview' && (
        <div style={{ padding: 16 }}>
          <div className="onboarding-pitch-row">
            <div className="onboarding-pitch-icon">★</div>
            <div className="onboarding-pitch-text">
              <h4>Premium Ranking Boost</h4>
              <p>Make your items show up first in search lists.</p>
            </div>
          </div>

          <div className="onboarding-pitch-row">
            <div className="onboarding-pitch-icon">📢</div>
            <div className="onboarding-pitch-text">
              <h4>Homepage Banners</h4>
              <p>Advertise banner campaigns on the customer landing tab.</p>
            </div>
          </div>

          <div className="onboarding-pitch-row">
            <div className="onboarding-pitch-icon">🏷</div>
            <div className="onboarding-pitch-text">
              <h4>Client Brand Support</h4>
              <p>Collaborate to sell under popular regional client brands.</p>
            </div>
          </div>
        </div>
      )}

      {activeGrowTab === 'Promote' && (
        <div style={{ padding: '8px 0' }}>
          {campaigns.map(c => (
            <div key={c.id} className="promotion-campaign-card">
              <div className="promo-campaign-header">
                <h4 className="promo-campaign-title">{c.name}</h4>
                <span className={`promo-campaign-status ${c.status === 'Active' ? 'active' : 'pending'}`}>
                  {c.status}
                </span>
              </div>
              <span className="promo-campaign-meta">{c.package} • {c.duration}</span>
              <div className="promo-campaign-footer">
                <span className="promo-campaign-price">₹{c.price}</span>
                <button className="promo-campaign-btn" onClick={() => handleStartCampaign(c.name, c.price, c.duration)}>Extend</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeGrowTab === 'Client Brand' && (
        <div style={{ padding: 16 }}>
          <h4 className="onboarding-title" style={{ fontSize: 14 }}>Co-Branded Retail Program</h4>
          <p className="onboarding-subtitle">Submit packaging design verification requests to list under major verified retail brands.</p>

          <div className="onboarding-form-group">
            <label className="onboarding-label">Select Brand Partner</label>
            <select className="onboarding-select">
              <option>Patanjali Co-op Brand</option>
              <option>Organica Green Fields</option>
              <option>Nirbhaya Women Handlooms</option>
            </select>
          </div>

          <div className="onboarding-form-group">
            <label className="onboarding-label">Commercial Percentage Share</label>
            <input type="text" className="onboarding-input" value="Standard 10% Platform commission" readOnly />
          </div>

          <button className="primary-onboarding-btn" onClick={() => triggerToast('Co-branding request submitted to partners!')}>
            Submit Packaging Request
          </button>
        </div>
      )}
    </>
  );
};

export default GrowTab;
