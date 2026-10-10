import React from 'react';
import { useSHG } from '../context/SHGContext';

const MODE_TITLE = { shg: 'SHG Store', ecommerce: 'Ecommerce', quick: 'Quick Commerce' };

const SHGEarningsTab = () => {
  const {
    payouts,
    payoutAmount,
    setPayoutAmount,
    handleRequestPayout,
    activeMode
  } = useSHG();

  // Withdrawable calculation
  const totalReceived = payouts.reduce((sum, p) => p.status === 'Successful' ? sum + p.amount : sum, 0);

  return (
    <div className="shg-tab-content" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      {/* There is no per-storefront payout ledger on the backend yet (no
          channel field on a payout, no /api/shg/payouts endpoint at all —
          `payouts` here is always empty). Once that exists this can filter
          by activeMode the same way Products/Orders/Dashboard already do;
          until then this is a label, not a filter, so it doesn't claim a
          breakdown the data can't back up. */}
      <div style={{ padding: '10px 18px 0', fontSize: 11.5, fontWeight: 700, color: 'var(--shg-text-muted)' }}>
        {MODE_TITLE[activeMode] || 'SHG Store'} — settlement ledger is combined across storefronts for now
      </div>

      {/* Earnings Overview Card */}
      <div className="shg-earnings-card">
        <div className="shg-earnings-label">Withdrawable Balance</div>
        <div className="shg-earnings-value">₹{totalReceived.toLocaleString('en-IN')}</div>

        <div className="shg-earnings-row">
          <div className="shg-earnings-pill">
            <div className="shg-earnings-pill-val">₹{totalReceived.toLocaleString('en-IN')}</div>
            <div className="shg-earnings-pill-label">Total Received</div>
          </div>
        </div>
      </div>

      {/* Payout / Withdrawal Request Section */}
      <div className="shg-section">
        <div className="shg-card">
          <div className="shg-card-header">
            <h4 className="shg-card-title">Withdraw to Group Bank Account</h4>
          </div>
          <div style={{ padding: 16 }}>
            <form onSubmit={handleRequestPayout} style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <div className="shg-form-group" style={{ flex: 1, margin: 0 }}>
                <label className="shg-label">Amount (₹)</label>
                <input 
                  type="number" 
                  className="shg-input" 
                  placeholder="Enter amount to withdraw"
                  value={payoutAmount}
                  onChange={(e) => setPayoutAmount(e.target.value)}
                  max={totalReceived}
                  required
                />
              </div>
              <button type="submit" className="shg-primary-btn" style={{ width: 'auto', padding: '12px 24px', margin: 0 }}>
                Request Payout
              </button>
            </form>
            <p style={{ margin: '8px 0 0 0', fontSize: 11, color: 'var(--shg-text-muted)', lineHeight: 1.4 }}>
              * Payout requests are processed and settled directly to the registered SHG Group Joint Account within 24 business hours.
            </p>
          </div>
        </div>
      </div>

      {/* Payout History Ledger */}
      <div className="shg-section" style={{ paddingBottom: 32 }}>
        <h4 className="shg-section-title">Transfer History Ledger</h4>
        <div className="shg-card">
          {payouts.length === 0 ? (
            <div className="shg-empty-state">
              <div className="shg-empty-icon">🏦</div>
              <p className="shg-empty-text">No payout transfers found.</p>
            </div>
          ) : (
            payouts.map(payout => (
              <div key={payout.id} className="shg-payout-row">
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--shg-text-primary)' }}>
                    {payout.method}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--shg-text-muted)', marginTop: 2 }}>
                    ID: {payout.id} • {payout.date}
                  </div>
                </div>
                
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--shg-text-primary)' }}>
                    ₹{payout.amount.toLocaleString('en-IN')}
                  </div>
                  <span className={`shg-status-badge ${payout.status === 'Successful' ? 'active' : 'pending'}`} style={{ display: 'inline-block', marginTop: 4 }}>
                    {payout.status}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default SHGEarningsTab;
