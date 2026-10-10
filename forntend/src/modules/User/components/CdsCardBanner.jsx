import React from 'react';

const CdsCardBanner = () => {
  return (
    <div className="cds-banner-container">
      <div className="cds-banner-card">
        {/* Left Side Content */}
        <div className="cds-banner-left">
          <h3 className="cds-title">CDS-Card</h3>
          <p className="cds-description">
            Unlock ₹5 Lakh<br />
            Emergency Help Eligibility
          </p>
          <button className="cds-view-btn">View Benefits</button>
        </div>

        {/* Right Side CDS Credit Card Render */}
        <div className="cds-banner-right">
          <div className="physical-cds-card">
            <div className="card-top">
              <span className="card-logo-text">CDS-CARD</span>
              <div className="card-shield-icon">
                {/* Shield with user avatar */}
                <svg width="24" height="24" viewBox="0 0 24 24" fill="#fbbf24">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
            </div>

            <div className="card-middle">
              {/* Card Chip */}
              <div className="card-chip">
                <div className="chip-line"></div>
                <div className="chip-line"></div>
              </div>
              
              {/* Card User silhouette symbol */}
              <div className="card-user-avatar">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="#fbbf24">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                </svg>
              </div>
            </div>

            <div className="card-bottom">
              <div className="card-info">
                <span className="card-number">1234 5678 9012 3456</span>
                <span className="card-holder">DHEERAJ KUMAR</span>
              </div>

              {/* QR Code representation */}
              <div className="card-qr-code">
                <div className="qr-row">
                  <span className="qr-dot black"></span>
                  <span className="qr-dot white"></span>
                  <span className="qr-dot black"></span>
                </div>
                <div className="qr-row">
                  <span className="qr-dot white"></span>
                  <span className="qr-dot black"></span>
                  <span className="qr-dot white"></span>
                </div>
                <div className="qr-row">
                  <span className="qr-dot black"></span>
                  <span className="qr-dot white"></span>
                  <span className="qr-dot black"></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CdsCardBanner;
