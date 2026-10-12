import React, { useState } from 'react';
import { useSeller } from '../context/SellerContext';
import { sellerTypeLabelFromModes } from '../utils/onboardingDraft';
import productHoney from '../../../assets/product_honey.png';

export const AccountTab = () => {
  const {
    activeFinanceTab,
    setActiveFinanceTab,
    bankForm,
    bizForm,
    addressForm,
    payoutAmount,
    setPayoutAmount,
    handleRequestPayout,
    payouts,
    supportTicketSubject,
    setSupportTicketSubject,
    supportTicketDesc,
    setSupportTicketDesc,
    handleCreateTicket,
    tickets,
    triggerToast,
    logoutSeller,
    selectedTypes,
    toggleSellerType
  } = useSeller();

  // Local states for additional account interactions
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  
  // Simulated Fallback States (Section 20 empty/loading/error checks)
  const [simulatedState, setSimulatedState] = useState('normal'); // normal, loading, error

  const handlePasswordChange = (e) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      triggerToast('Password must be at least 6 characters long');
      return;
    }
    triggerToast('Password changed successfully!');
    setShowPasswordModal(false);
    setNewPassword('');
  };

  // IF SIMULATED LOADING STATE IS ACTIVE
  if (simulatedState === 'loading') {
    return (
      <div style={{ padding: 16 }}>
        <h4 style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>SIMULATED LOADING STATE (SKELETONS)</h4>
        
        {/* Skeleton Profile */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
          <div style={{ width: 60, height: 60, borderRadius: '50%', backgroundColor: '#e2e8f0', animation: 'pulse 1.5s infinite' }} />
          <div style={{ flex: 1 }}>
            <div style={{ height: 16, backgroundColor: '#e2e8f0', borderRadius: 4, width: '60%', marginBottom: 6, animation: 'pulse 1.5s infinite' }} />
            <div style={{ height: 12, backgroundColor: '#e2e8f0', borderRadius: 4, width: '40%', animation: 'pulse 1.5s infinite' }} />
          </div>
        </div>

        {/* Skeleton Cards */}
        {[1, 2].map(i => (
          <div key={i} style={{ padding: 16, backgroundColor: '#ffffff', borderRadius: 12, border: '1.5px solid #e2e8f0', marginBottom: 12 }}>
            <div style={{ height: 14, backgroundColor: '#e2e8f0', borderRadius: 4, width: '30%', marginBottom: 10, animation: 'pulse 1.5s infinite' }} />
            <div style={{ height: 10, backgroundColor: '#e2e8f0', borderRadius: 4, width: '80%', marginBottom: 6, animation: 'pulse 1.5s infinite' }} />
            <div style={{ height: 10, backgroundColor: '#e2e8f0', borderRadius: 4, width: '50%', animation: 'pulse 1.5s infinite' }} />
          </div>
        ))}

        <button className="secondary-onboarding-btn" style={{ marginTop: 10 }} onClick={() => setSimulatedState('normal')}>
          Back to Normal
        </button>
      </div>
    );
  }

  // IF SIMULATED ERROR STATE IS ACTIVE
  if (simulatedState === 'error') {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <span style={{ fontSize: 40, display: 'block', marginBottom: 16 }}>🔌</span>
        <h4 className="onboarding-title" style={{ fontSize: 16, marginBottom: 8 }}>Connection Lost</h4>
        <p className="onboarding-subtitle" style={{ fontSize: 12, marginBottom: 24 }}>
          Unable to load data. Please check your connection.
        </p>
        <button className="primary-onboarding-btn" onClick={() => { setSimulatedState('normal'); triggerToast('Connection restored.'); }}>
          Retry Connection
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="seller-scroll-tabs">
        {['Overview', 'Payouts', 'Profile', 'Support'].map(fTab => (
          <button 
            key={fTab}
            className={`seller-tab-btn ${activeFinanceTab === fTab ? 'active' : ''}`}
            onClick={() => setActiveFinanceTab(fTab)}
          >
            {fTab}
          </button>
        ))}
      </div>

      {/* SUBTAB 1: FINANCIAL OVERVIEW */}
      {activeFinanceTab === 'Overview' && (
        <>
          {/* Bank Card Graphic */}
          <div style={{ padding: 16 }}>
            <div className="finance-bank-card">
              <div className="finance-bank-header">Connected Payout Account</div>
              <div className="finance-bank-number">**** **** 4567</div>
              <div className="finance-bank-footer">
                <span>{bankForm.holderName || '—'}</span>
                <span>{bankForm.bankName || '—'}</span>
              </div>
            </div>
          </div>

          {/* Earnings report balance sheet */}
          <div className="earnings-breakdown-box">
            <h4 className="section-card-title">EARNINGS BREAKDOWN</h4>
            <div className="finance-breakdown-row">
              <span className="finance-row-key">Product Sales Revenue</span>
              <span className="finance-row-val">₹25,680</span>
            </div>
            <div className="finance-breakdown-row">
              <span className="finance-row-key">Commission Deductions (10%)</span>
              <span className="finance-row-val">-₹2,568</span>
            </div>
            <div className="finance-breakdown-row">
              <span className="finance-row-key">Tax / Logistics Fees</span>
              <span className="finance-row-val">-₹4,362</span>
            </div>
            <div className="finance-breakdown-row">
              <span className="finance-row-key">Net Available Balance</span>
              <span className="finance-row-val">₹18,750</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, padding: '0 16px' }}>
            <button className="primary-onboarding-btn" onClick={() => setActiveFinanceTab('Payouts')}>
              Withdraw Money
            </button>
            <button className="secondary-onboarding-btn" onClick={() => triggerToast('PDF sales statement statement downloaded.')}>
              Export PDF
            </button>
          </div>
        </>
      )}

      {/* SUBTAB 2: WITHDRAWAL PAYOUTS */}
      {activeFinanceTab === 'Payouts' && (
        <div style={{ padding: 16 }}>
          <div className="earnings-breakdown-box" style={{ margin: 0, marginBottom: 16 }}>
            <span className="finance-row-key" style={{ fontSize: 11 }}>Total Withdrawable Sales</span>
            <h2 className="onboarding-title" style={{ fontSize: 26, margin: '8px 0' }}>₹12,450</h2>
          </div>

          <form onSubmit={handleRequestPayout}>
            <div className="onboarding-form-group">
              <label className="onboarding-label">Enter Payout Amount</label>
              <input 
                type="number" 
                className="onboarding-input" 
                placeholder="₹ enter amount" 
                value={payoutAmount}
                onChange={(e) => setPayoutAmount(e.target.value)}
              />
            </div>
            
            <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
              {[1000, 5000, 10000].map(val => (
                <button 
                  key={val} 
                  type="button" 
                  className="seller-tab-btn" 
                  style={{ flex: 1 }}
                  onClick={() => setPayoutAmount(String(val))}
                >
                  ₹{val}
                </button>
              ))}
            </div>

            <button type="submit" className="primary-onboarding-btn">
              Submit Money Request
            </button>
          </form>

          {/* Request Payout Logs history list */}
          <h4 className="onboarding-title" style={{ fontSize: 13, marginTop: 24, marginBottom: 12 }}>REQUEST HISTORY</h4>
          {payouts.map(pay => (
            <div key={pay.id} className="review-summary-card" style={{ margin: '0 0 10px 0' }}>
              <div className="review-item-row">
                <span className="review-item-key">Request ID: {pay.id}</span>
                <span className="review-item-val" style={{ color: pay.status === 'Successful' ? 'var(--primary)' : 'var(--warning)' }}>{pay.status}</span>
              </div>
              <div className="review-item-row" style={{ marginTop: 4 }}>
                <span className="review-item-key">{pay.date}</span>
                <span className="review-item-val">₹{pay.amount}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SUBTAB 3: DEDICATED PROFILE SECTION */}
      {activeFinanceTab === 'Profile' && (
        <div style={{ padding: 16 }}>
          {/* Identity Card */}
          <div className="dashboard-identity-card" style={{ margin: 0, marginBottom: 16 }}>
            <img src={productHoney} alt="Store Profile" className="dashboard-avatar" />
            <div className="dashboard-identity-details">
              <h3 className="dashboard-store-name">{bizForm.storeName || 'Your store'}</h3>
              <span className="verified-badge" style={{ display: 'inline-block', marginTop: 4 }}>✓ Verified Seller</span>
            </div>
          </div>

          {/* Profile credentials list */}
          <div className="review-summary-card" style={{ margin: '0 0 16px 0' }}>
            <div className="review-card-header">
              <h4 className="review-card-title">Business Information</h4>
              <button className="review-edit-btn" onClick={() => triggerToast('Profile editing enabled in next release.')}>Edit</button>
            </div>
            <div className="review-item-row">
              <span className="review-item-key">Seller Name</span>
              <span className="review-item-val">{bankForm.holderName || 'Not provided'}</span>
            </div>
            <div className="review-item-row">
              <span className="review-item-key">Classification</span>
              <span className="review-item-val">{sellerTypeLabelFromModes(selectedTypes)}</span>
            </div>
            
            {/* Enabled Sales Channels Row */}
            <div className="review-item-row" style={{ borderTop: '1px dashed #e2e8f0', paddingTop: 10, marginTop: 10 }}>
              <span className="review-item-key" style={{ fontWeight: '800' }}>Sales Channels</span>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: '700', cursor: 'pointer', color: 'var(--text-primary)' }}>
                  <input 
                    type="checkbox" 
                    checked={selectedTypes.includes('ecommerce')} 
                    onChange={() => toggleSellerType('ecommerce')}
                    style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                  />
                  E-Commerce
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: '700', cursor: 'pointer', color: 'var(--text-primary)' }}>
                  <input 
                    type="checkbox" 
                    checked={selectedTypes.includes('quick')} 
                    onChange={() => toggleSellerType('quick')}
                    style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                  />
                  Quick Commerce
                </label>
              </div>
            </div>
          </div>

          {/* Address Details */}
          <div className="review-summary-card" style={{ margin: '0 0 16px 0' }}>
            <div className="review-card-header">
              <h4 className="review-card-title">Store Address</h4>
            </div>
            <div className="review-item-row">
              <span className="review-item-key">Street</span>
              <span className="review-item-val">{addressForm.street || 'Not provided'}</span>
            </div>
            <div className="review-item-row">
              <span className="review-item-key">District / Pin</span>
              <span className="review-item-val">{addressForm.district || '—'} - {addressForm.pincode || '—'}</span>
            </div>
          </div>

          {/* Connected Documents checklist status */}
          <div className="review-summary-card" style={{ margin: '0 0 16px 0' }}>
            <div className="review-card-header">
              <h4 className="review-card-title">Document Status</h4>
            </div>
            <div className="review-item-row">
              <span className="review-item-key">Aadhaar scan scan</span>
              <span className="review-item-val" style={{ color: 'var(--primary)', fontWeight: 800 }}>✓ Verified</span>
            </div>
            <div className="review-item-row">
              <span className="review-item-key">PAN card details</span>
              <span className="review-item-val" style={{ color: 'var(--primary)', fontWeight: 800 }}>✓ Verified</span>
            </div>
          </div>

          {/* Account/Security actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button className="primary-onboarding-btn" onClick={() => setShowPasswordModal(true)}>
              Change Password
            </button>
            <button className="secondary-onboarding-btn" style={{ borderColor: 'var(--error)', color: 'var(--error)' }} onClick={() => { if (window.confirm('Logout from seller panel?')) logoutSeller(); }}>
              Exit / Logout
            </button>
          </div>
        </div>
      )}

      {/* SUBTAB 4: HELP DESK / SUPPORT */}
      {activeFinanceTab === 'Support' && (
        <div style={{ padding: 16 }}>
          <h4 className="onboarding-title" style={{ fontSize: 14 }}>Business Help Desk</h4>
          
          {/* Collapsible FAQ list */}
          <div className="faq-row" onClick={() => triggerToast('Answer: In active panel tabs, choose products catalog tab, tap add product, input price specifications, variants, and tap save!')}>
            <span className="faq-question">How to add products?</span>
            <span className="faq-chevron">›</span>
          </div>

          <div className="faq-row" onClick={() => triggerToast('Answer: In active panel tabs, choose orders tab, select confirmed item, mark ship package.')}>
            <span className="faq-question">How to track orders?</span>
            <span className="faq-chevron">›</span>
          </div>

          <div className="faq-row" onClick={() => triggerToast('Answer: Under account menu, navigate to payouts subtab, select HDFC bank transfer payout option.')}>
            <span className="faq-question">How to request payouts?</span>
            <span className="faq-chevron">›</span>
          </div>

          {/* Ticket creator */}
          <h4 className="onboarding-title" style={{ fontSize: 13, marginTop: 20, marginBottom: 12 }}>CREATE TICKET</h4>
          <form onSubmit={handleCreateTicket}>
            <div className="onboarding-form-group">
              <label className="onboarding-label">Subject</label>
              <input 
                type="text" 
                className="onboarding-input" 
                placeholder="What is your issue about?" 
                value={supportTicketSubject}
                onChange={(e) => setSupportTicketSubject(e.target.value)}
              />
            </div>
            <div className="onboarding-form-group">
              <label className="onboarding-label">Describe Problem</label>
              <textarea 
                className="onboarding-textarea" 
                placeholder="Provide details..." 
                value={supportTicketDesc}
                onChange={(e) => setSupportTicketDesc(e.target.value)}
              />
            </div>
            <button type="submit" className="primary-onboarding-btn">
              Submit Ticket
            </button>
          </form>

          {/* Active Support Tickets */}
          <h4 className="onboarding-title" style={{ fontSize: 13, marginTop: 20, marginBottom: 12 }}>TICKET HISTORY</h4>
          {tickets.map(t => (
            <div key={t.id} className="review-summary-card" style={{ margin: '0 0 10px 0' }}>
              <div className="review-item-row">
                <span className="review-item-key">Ticket ID: {t.id}</span>
                <span className="ticket-status-pill resolved" style={{ backgroundColor: t.status === 'Resolved' ? 'var(--primary-light)' : '#eff6ff', color: t.status === 'Resolved' ? 'var(--primary)' : 'var(--info)' }}>{t.status}</span>
              </div>
              <div className="review-item-row" style={{ marginTop: 4 }}>
                <span className="review-item-key">{t.subject}</span>
                <span className="review-item-val">{t.date}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* STATE DEMO SWITCHER FOOTER STRIP */}
      <div style={{ margin: '20px 16px 10px 16px', padding: 12, backgroundColor: '#f8fafc', borderRadius: 12, border: '1.5px dashed #cbd5e1' }}>
        <h5 style={{ margin: '0 0 8px 0', fontSize: 10, color: 'var(--text-secondary)', fontWeight: 800 }}>DEMO UI STATE TESTING (Section 20)</h5>
        <div style={{ display: 'flex', gap: 6 }}>
          {['normal', 'loading', 'error'].map(st => (
            <button 
              key={st}
              className="seller-tab-btn"
              style={{ flex: 1, padding: '4px 0', fontSize: 9 }}
              onClick={() => setSimulatedState(st)}
            >
              {st.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* CHANGE PASSWORD DIALOG SHEET */}
      {showPasswordModal && (
        <div className="seller-modal-overlay">
          <div className="seller-modal-sheet">
            <div className="modal-sheet-header">
              <h3 className="modal-sheet-title">Change Password</h3>
              <button className="modal-close-btn" onClick={() => setShowPasswordModal(false)}>✕</button>
            </div>
            <form onSubmit={handlePasswordChange}>
              <div className="onboarding-form-group">
                <label className="onboarding-label">Enter New Password</label>
                <input 
                  type="password" 
                  className="onboarding-input" 
                  placeholder="At least 6 characters" 
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="primary-onboarding-btn">
                Confirm Update
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default AccountTab;
