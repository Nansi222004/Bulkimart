import React, { useState, useEffect } from 'react';
import { useDelivery } from '../context/DeliveryContext';
import DepositModal from '../components/DepositModal';
import DeliveryFinancePanel from '../components/DeliveryFinancePanel';

export const EarningsPage = () => {
  const {
    payoutBalance,
    cashoutEarnings,
    payoutHistory,
    payoutRequesting,
    payoutActionsEnabled,
    fetchPayoutHistory,
    debitWallet,
    settleDebitWallet,
    earningsData,
    riderProfile
  } = useDelivery();

  const [period, setPeriod] = useState('daily'); // daily, weekly, lifetime
  const [showDeposit, setShowDeposit] = useState(false);

  useEffect(() => { fetchPayoutHistory(); }, [fetchPayoutHistory]);

  const hasPendingRequest = payoutHistory.some((p) => p.status === 'pending');

  const data = earningsData[period];

  /**
   * A figure we cannot vouch for is shown as a dash, never as ₹0. Only
   * `lifetime` survives a reload — it comes from the partner record in Mongo —
   * while today's and this week's totals are known only from trips completed
   * since this tab was opened.
   */
  const money = (n) => (data.available ? `₹${n}` : '—');
  const count = (n) => (data.available ? n : '—');

  return (
    <div className="delivery-earnings-wrapper">
      <DeliveryFinancePanel />
      {/* Payout balance top card */}
      <div className="delivery-card delivery-payout-balance-card">
        <span className="delivery-card-title" style={{ color: 'rgba(255,255,255,0.85)' }}>Available Payout Balance</span>
        <div className="delivery-payout-row">
          <span className="delivery-payout-amount">₹{payoutBalance}</span>
          <button
            className="delivery-cashout-btn"
            onClick={cashoutEarnings}
            disabled={!payoutActionsEnabled || payoutBalance === 0 || payoutRequesting || hasPendingRequest}
          >
            {payoutRequesting ? 'Requesting…' : hasPendingRequest ? 'Request pending' : 'Cashout to Bank'}
          </button>
        </div>
        <p className="delivery-payout-footer-label">
          Linked Bank: {riderProfile?.bankDetails?.bankName
            ? `${riderProfile.bankDetails.bankName} (•••• ${riderProfile.bankDetails.accountNo ? riderProfile.bankDetails.accountNo.slice(-4) : '4321'})`
            : 'No bank/UPI on file — add one before requesting a payout'}
        </p>
        {hasPendingRequest && (
          <p className="delivery-payout-footer-label">
            A payout request is already awaiting processing — it will settle to your bank/UPI, tracked below.
          </p>
        )}
      </div>

      {/* Payout request history */}
      {payoutHistory.length > 0 && (
        <div className="delivery-card delivery-transaction-log-card">
          <h4 className="delivery-breakdown-title">PAYOUT REQUESTS</h4>
          <div className="delivery-transaction-list">
            {payoutHistory.map((p) => (
              <div key={p._id} className="delivery-txn-row">
                <div className="txn-left">
                  <span className="txn-icon">🏦</span>
                  <div className="txn-meta">
                    <span className="txn-title">
                      {p.status === 'completed' ? 'Paid out' : p.status === 'rejected' ? 'Rejected' : 'Pending'}
                    </span>
                    <span className="txn-time">{new Date(p.createdAt).toLocaleString()}</span>
                    {p.transactionRef && <span className="txn-time">Transfer: {p.transactionRef}</span>}
                    {p.rejectionReason && <span className="txn-time">{p.rejectionReason}</span>}
                  </div>
                </div>
                <div className="txn-right">
                  <span className="txn-amount">₹{p.amount}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Period Toggle Filter */}
      <div className="delivery-earnings-filter-pill-row">
        {['daily', 'weekly', 'lifetime'].map(p => (
          <button 
            key={p} 
            className={`delivery-filter-pill-btn ${period === p ? 'active' : ''}`} 
            onClick={() => setPeriod(p)}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      {/* KPI stats section based on selected filter */}
      <div className="delivery-card delivery-earnings-breakdown-card">
        <h4 className="delivery-breakdown-title">
          {period === 'daily' && 'TODAY\'S EARNINGS SUMMARY'}
          {period === 'weekly' && 'WEEKLY CYCLE SUMMARY'}
          {period === 'lifetime' && 'ALL-TIME EARNINGS SUMMARY'}
        </h4>

        <div className="delivery-earnings-stats-grid">
          <div className="earnings-stat-item">
            <span className="earnings-stat-label">Total Pay</span>
            <span className="earnings-stat-val primary-color">{money(data.total)}</span>
          </div>
          <div className="earnings-stat-item">
            <span className="earnings-stat-label">Total Trips</span>
            <span className="earnings-stat-val">{count(data.trips)}</span>
          </div>
        </div>

        {/*
          Tips, called out on their own rather than left inside Total Pay.
          It is the one part of the figure that came from the customer's own
          judgement of the delivery, and the whole amount is the rider's.
        */}
        {data.available && (
          <div className="delivery-tips-summary-row">
            <div className="delivery-tips-summary-left">
              <span className="delivery-tips-icon">🎉</span>
              <div className="delivery-tips-meta">
                <span className="delivery-tips-title">Customer Tips</span>
                <span className="delivery-tips-sub">
                  {data.tips > 0
                    ? 'Paid to you in full — already included in Total Pay'
                    : 'No tips yet for this period'}
                </span>
              </div>
            </div>
            <span className="delivery-tips-amount">₹{data.tips || 0}</span>
          </div>
        )}

        {!data.available && (
          <p className="delivery-payout-footer-label">
            {period === 'daily'
              ? 'Trips finished in this session are counted here. Reopening the app clears it — your all-time total is always kept.'
              : 'Weekly figures are not available yet. Your all-time total is on the Lifetime tab.'}
          </p>
        )}
      </div>

      {/* Period Visualizations (Simple Bar Chart Lists for Weekly/Yearly) */}
      {period === 'weekly' && data.available && (
        <div className="delivery-card delivery-graph-card">
          <h4 className="delivery-breakdown-title">DAY-BY-DAY EARNINGS</h4>
          <div className="delivery-bar-graph-list">
            {data.days.map(d => (
              <div key={d.day} className="delivery-bar-graph-row">
                <span className="bar-label">{d.day}</span>
                <div className="bar-wrapper">
                  <div 
                    className="bar-fill" 
                    style={{ width: `${Math.min((d.amount / 1200) * 100, 100)}%` }}
                  />
                </div>
                <span className="bar-value">₹{d.amount}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transaction List / Delivery Logs */}
      {period === 'daily' && data.breakdown.length > 0 && (
        <div className="delivery-card delivery-transaction-log-card">
          <h4 className="delivery-breakdown-title">TODAY'S TRIP LOG</h4>
          <div className="delivery-transaction-list">
            {data.breakdown.map(txn => (
              <div key={txn.id} className="delivery-txn-row">
                <div className="txn-left">
                  <span className="txn-icon">🏍️</span>
                  <div className="txn-meta">
                    <span className="txn-title">{txn.type}</span>
                    <span className="txn-time">{txn.time} • Order {txn.orderId}</span>
                  </div>
                </div>
                <div className="txn-right">
                  <span className="txn-amount">₹{txn.amount}</span>
                  {txn.tip > 0 && (
                    <span className="txn-tip-badge">Includes ₹{txn.tip} tip</span>
                  )}
                  {txn.isCod && (
                    <span className="txn-cod-badge">COD Collected: ₹{txn.codAmount}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* COD Settlement Section (Floating Cash check) */}
      <div className="delivery-card delivery-cod-settlement-bottom-card">
        <div className="cod-bottom-left">
          <span>COD cash reported outstanding</span>
          <strong>₹{debitWallet}</strong>
        </div>
        <button 
          className="delivery-secondary-action-btn"
          onClick={() => setShowDeposit(true)}
          disabled={debitWallet === 0}
        >
          Settle COD Cash
        </button>
      </div>

      {/* Deposit cash modal */}
      <DepositModal 
        isOpen={showDeposit} 
        onClose={() => setShowDeposit(false)} 
      />
    </div>
  );
};

export default EarningsPage;
