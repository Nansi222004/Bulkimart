import ModalPortal from '../../../components/ModalPortal';
import React, { useState } from 'react';
import { useDelivery } from '../context/DeliveryContext';

export const DepositModal = ({ isOpen, onClose }) => {
  const { debitWallet, settleDebitWallet } = useDelivery();
  const [depositAmount, setDepositAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('UPI');

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const success = settleDebitWallet(depositAmount);
    if (success) {
      setDepositAmount('');
      onClose();
    }
  };

  const handleQuickAdd = (amt) => {
    setDepositAmount(amt.toString());
  };

  return (
    <ModalPortal className="delivery-modal-overlay">
      <div className="delivery-order-ping-modal-sheet" style={{ borderRadius: '24px 24px 0 0', textAlign: 'left' }}>
        
        {/* Title */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#0f172a' }}>Deposit Cash to Company</h3>
          <button 
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#64748b' }}
          >
            ✕
          </button>
        </div>

        <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 16px 0', lineHeight: 1.4 }}>
          Transfer collected Cash On Delivery (COD) money to the company to clear your liability and unlock orders.
        </p>

        {/* Balance Status */}
        <div style={{ backgroundColor: '#fff7ed', border: '1px solid #ffedd5', borderRadius: 12, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <span style={{ fontSize: 9, fontWeight: 800, color: '#c2410c', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Cash in Hand (Owed)</span>
            <h4 style={{ margin: '4px 0 0 0', fontSize: 22, fontWeight: 900, color: '#7c2d12' }}>₹{debitWallet}</h4>
          </div>
          <button 
            className="delivery-settle-btn"
            onClick={() => {
              setDepositAmount(debitWallet.toString());
            }}
            style={{ padding: '6px 12px', fontSize: 10 }}
          >
            Use Max
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          
          {/* Amount input */}
          <div className="delivery-input-group" style={{ margin: 0 }}>
            <label className="delivery-input-label">Deposit Amount (₹)</label>
            <input 
              type="number"
              max={debitWallet}
              min="1"
              required
              className="delivery-text-input"
              placeholder="e.g. 500"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
            />
          </div>

          {/* Quick options */}
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
            {[200, 500, 1000].map(amt => (
              <button 
                type="button"
                key={amt}
                disabled={amt > debitWallet}
                onClick={() => handleQuickAdd(amt)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 16,
                  border: '1.5px solid #cbd5e1',
                  backgroundColor: '#fff',
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#475569',
                  cursor: 'pointer',
                  opacity: amt > debitWallet ? 0.4 : 1
                }}
              >
                +₹{amt}
              </button>
            ))}
          </div>

          {/* Payment Method selector */}
          <div className="delivery-input-group" style={{ margin: 0 }}>
            <label className="delivery-input-label">Select Payment Method</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              {[
                { id: 'UPI', label: 'UPI apps (GooglePay, PhonePe)', icon: '📱' },
                { id: 'BANK', label: 'Linked Cooperative Bank', icon: '🏦' },
                { id: 'CARD', label: 'Debit / Credit Card', icon: '💳' }
              ].map(method => (
                <label 
                  key={method.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 12,
                    border: '1.5px solid #cbd5e1',
                    borderRadius: 10,
                    cursor: 'pointer',
                    backgroundColor: paymentMethod === method.id ? '#ebfdf2' : '#fff',
                    borderColor: paymentMethod === method.id ? '#1b7a37' : '#cbd5e1'
                  }}
                  onClick={() => setPaymentMethod(method.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 16 }}>{method.icon}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: '#334155' }}>{method.label}</span>
                  </div>
                  <input 
                    type="radio" 
                    name="paymethod"
                    checked={paymentMethod === method.id}
                    onChange={() => {}}
                    style={{ accentColor: '#1b7a37' }}
                  />
                </label>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="delivery-btn-row" style={{ marginTop: 8 }}>
            <button 
              type="button" 
              className="delivery-secondary-action-btn"
              onClick={onClose}
              style={{ flex: 1 }}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="delivery-primary-action-btn"
              style={{ flex: 2, margin: 0 }}
            >
              Confirm Deposit
            </button>
          </div>
        </form>

      </div>
    </ModalPortal>
  );
};

export default DepositModal;
