import React from 'react';
import { useSeller } from '../context/SellerContext';

export const MoneyRequestTab = () => {
  const {
    payoutAmount,
    setPayoutAmount,
    handleRequestPayout,
    payouts,
    selectedTypes,
    activeMode,
    setActiveMode
  } = useSeller();

  const mockPayouts = payouts?.length ? payouts : [
    { id: 'PAY849201', method: 'Bank Transfer (HDFC)', date: '08 Oct 2026', amount: 5000, status: 'Successful' },
    { id: 'PAY729104', method: 'Bank Transfer (HDFC)', date: '28 Sept 2026', amount: 6030, status: 'Successful' },
  ];

  return (
    <div style={{ padding: '0 4px 40px 4px' }}>
      <style dangerouslySetInnerHTML={{__html: `
        .payout-card-hover {
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .payout-card-hover:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(0,0,0,0.04);
        }
        .chip-btn {
          border: 1.5px solid #e2e8f0;
          background-color: #fff;
          color: #334155;
          padding: 8px 16px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s ease;
          flex: 1;
          text-align: center;
        }
        .chip-btn:hover {
          border-color: #10b981;
          color: #10b981;
          background-color: #f0fdf4;
        }
        .chip-btn.active {
          border-color: #10b981;
          background-color: #10b981;
          color: #fff;
          box-shadow: 0 2px 6px rgba(16,185,129,0.25);
        }
      `}} />

      {/* Header */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
        gap: 12
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
              Money Request
            </h1>
            <span style={{
              backgroundColor: '#ecfdf5',
              color: '#047857',
              fontSize: 10,
              fontWeight: 800,
              padding: '3px 8px',
              borderRadius: 20,
              letterSpacing: '0.5px'
            }}>
              PAYOUTS & SETTLEMENTS
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#64748b', fontWeight: 500 }}>
            Request instant store payouts and manage your connected bank account.
          </p>
        </div>
      </div>

      {/* Mode Switcher Toggle */}
      {selectedTypes && selectedTypes.includes('ecommerce') && selectedTypes.includes('quick') && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          margin: '0 0 16px 0'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            padding: '2px',
            backgroundColor: '#f1f5f9',
            borderRadius: '12px',
            border: '1.5px solid #e2e8f0'
          }}>
            <button 
              onClick={() => setActiveMode('ecommerce')}
              style={{
                border: 'none',
                background: activeMode === 'ecommerce' ? 'linear-gradient(135deg, #3b82f6, #1d4ed8)' : 'none',
                color: activeMode === 'ecommerce' ? '#fff' : '#64748b',
                fontSize: '11px',
                fontWeight: '800',
                padding: '6px 12px',
                borderRadius: '10px',
                cursor: 'pointer',
                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: activeMode === 'ecommerce' ? '0 2px 4px rgba(37, 99, 235, 0.2)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
            >
              📦 E-Commerce
            </button>
            <button 
              onClick={() => setActiveMode('quick')}
              style={{
                border: 'none',
                background: activeMode === 'quick' ? 'linear-gradient(135deg, #10b981, #047857)' : 'none',
                color: activeMode === 'quick' ? '#fff' : '#64748b',
                fontSize: '11px',
                fontWeight: '800',
                padding: '6px 12px',
                borderRadius: '10px',
                cursor: 'pointer',
                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: activeMode === 'quick' ? '0 2px 4px rgba(16, 185, 129, 0.2)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
            >
              ⚡ Quick Commerce
            </button>
          </div>
        </div>
      )}

      {/* Available Balance Hero Card */}
      <div style={{
        marginBottom: 20,
        padding: '24px 28px',
        background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
        borderRadius: 20,
        color: '#fff',
        boxShadow: '0 10px 25px -5px rgba(16, 185, 129, 0.3)',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Background Decorative Circles */}
        <div style={{
          position: 'absolute',
          top: '-20px',
          right: '-20px',
          width: 140,
          height: 140,
          borderRadius: '50%',
          backgroundColor: 'rgba(255, 255, 255, 0.08)',
          pointerEvents: 'none'
        }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', opacity: 0.9 }}>
            AVAILABLE WITHDRAWABLE BALANCE
          </span>
          <span style={{ backgroundColor: 'rgba(255,255,255,0.2)', fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 20 }}>
            READY TO WITHDRAW
          </span>
        </div>

        <div style={{ fontSize: 36, fontWeight: 900, fontFamily: "'Outfit', sans-serif", letterSpacing: '-0.5px', marginBottom: 16 }}>
          ₹12,450
        </div>

        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          paddingTop: 14,
          borderTop: '1px solid rgba(255, 255, 255, 0.2)',
          fontSize: 12,
          fontWeight: 600,
          opacity: 0.95
        }}>
          <div>
            <span style={{ opacity: 0.75 }}>Pending clearance: </span>
            <span style={{ fontWeight: 800 }}>₹3,200</span>
          </div>
          <div>•</div>
          <div>
            <span style={{ opacity: 0.75 }}>Total Paid out: </span>
            <span style={{ fontWeight: 800 }}>₹11,030</span>
          </div>
        </div>
      </div>

      {/* Connected Bank Info Card */}
      <div style={{
        marginBottom: 24,
        padding: 16,
        backgroundColor: '#fff',
        borderRadius: 16,
        border: '1.5px solid #f1f5f9',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: '0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            backgroundColor: '#ecfdf5',
            color: '#059669',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            flexShrink: 0
          }}>
            🏦
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>HDFC Bank — **** 4567</span>
              <span style={{ fontSize: 9, fontWeight: 800, color: '#10b981', backgroundColor: '#dcfce7', padding: '2px 6px', borderRadius: 10 }}>PRIMARY</span>
            </div>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500, marginTop: 2 }}>
              Preeti Devi • Savings Account
            </div>
          </div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#10b981', cursor: 'pointer' }}>
          Verified ✓
        </span>
      </div>

      {/* Payout Request Form Card */}
      <div style={{
        marginBottom: 24,
        backgroundColor: '#fff',
        borderRadius: 20,
        border: '1.5px solid #f1f5f9',
        padding: 20,
        boxShadow: '0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02)'
      }}>
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
            💸 Request Payout
          </h3>
          <p style={{ margin: '3px 0 0 0', fontSize: 12, color: '#64748b', fontWeight: 500 }}>
            Enter amount or select quick payout chip below.
          </p>
        </div>

        <form onSubmit={handleRequestPayout}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.5px' }}>
              Withdrawal Amount (₹)
            </label>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: '#f8fafc',
              border: '1.5px solid #e2e8f0',
              borderRadius: 14,
              padding: '12px 16px',
              transition: 'border-color 0.2s'
            }}>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', marginRight: 8 }}>₹</span>
              <input
                type="number"
                placeholder="e.g. 5000"
                value={payoutAmount}
                onChange={(e) => setPayoutAmount(e.target.value)}
                style={{
                  border: 'none',
                  outline: 'none',
                  background: 'none',
                  fontSize: 20,
                  fontWeight: 800,
                  color: '#0f172a',
                  width: '100%',
                  fontFamily: "'Outfit', sans-serif"
                }}
              />
              {payoutAmount && (
                <button
                  type="button"
                  onClick={() => setPayoutAmount('')}
                  style={{ border: 'none', background: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Quick Amount Select Chips */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {[1000, 2500, 5000, 10000].map((val) => {
              const isActive = Number(payoutAmount) === val;
              return (
                <button
                  key={val}
                  type="button"
                  className={`chip-btn ${isActive ? 'active' : ''}`}
                  onClick={() => setPayoutAmount(String(val))}
                >
                  ₹{(val / 1000).toFixed(val >= 1000 ? 0 : 1)}k
                </button>
              );
            })}
          </div>

          {/* Processing Notice Alert */}
          <div style={{
            padding: '12px 16px',
            backgroundColor: '#ecfdf5',
            borderRadius: 12,
            border: '1px solid #a7f3d0',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 10
          }}>
            <span style={{ fontSize: 16 }}>💡</span>
            <p style={{ margin: 0, fontSize: 12, color: '#047857', fontWeight: 600 }}>
              Payouts are processed within 2–3 business days directly to your verified bank account. Minimum withdrawal amount: ₹500.
            </p>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            style={{
              width: '100%',
              border: 'none',
              background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
              color: '#fff',
              padding: '14px 20px',
              borderRadius: 14,
              fontSize: 14,
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)',
              transition: 'transform 0.15s ease, boxShadow 0.15s ease'
            }}
          >
            Submit Payout Request
          </button>
        </form>
      </div>

      {/* Recent Requests Section */}
      <div style={{
        backgroundColor: '#fff',
        borderRadius: 20,
        border: '1.5px solid #f1f5f9',
        padding: 20,
        boxShadow: '0 1px 3px rgba(0,0,0,0.01), 0 10px 15px -3px rgba(0,0,0,0.02)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
            📋 Recent Payout Requests
          </h3>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>
            {mockPayouts.length} transactions
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {mockPayouts.map((pay) => {
            const isSuccess = pay.status === 'Successful';
            return (
              <div 
                key={pay.id} 
                className="payout-card-hover"
                style={{
                  padding: '14px 16px',
                  backgroundColor: '#fff',
                  border: '1.5px solid #f1f5f9',
                  borderRadius: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    backgroundColor: isSuccess ? '#dcfce7' : '#fef3c7',
                    color: isSuccess ? '#15803d' : '#b45309',
                    fontSize: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    {isSuccess ? '✓' : '⏳'}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>
                      Request #{pay.id}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500, marginTop: 2 }}>
                      {pay.method || 'Bank Transfer (HDFC)'} • {pay.date}
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 15, fontWeight: 900, color: '#0f172a', fontFamily: "'Outfit', sans-serif" }}>
                    ₹{Number(pay.amount).toLocaleString('en-IN')}
                  </div>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: 12,
                    display: 'inline-block',
                    marginTop: 3,
                    backgroundColor: isSuccess ? '#dcfce7' : '#fef3c7',
                    color: isSuccess ? '#166534' : '#b45309'
                  }}>
                    {pay.status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default MoneyRequestTab;
