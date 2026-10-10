import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';

/**
 * Admin — Referral monitoring queue + cost report. The cost report is the
 * visible half of "Admin bears the full coin cost": every coin issued
 * under this program, converted to ₹ at the live CoinConfig.coinValue.
 */

const STATUS_COLORS = {
  PENDING:   { bg: '#e0f2fe', fg: '#075985' },
  QUALIFIED: { bg: '#fef9c3', fg: '#854d0e' },
  CREDITED:  { bg: '#dcfce7', fg: '#166534' },
  BLOCKED:   { bg: '#fee2e2', fg: '#991b1b' },
  EXPIRED:   { bg: '#f1f5f9', fg: '#475569' },
};

const StatusBadge = ({ status }) => {
  const c = STATUS_COLORS[status] || STATUS_COLORS.EXPIRED;
  return (
    <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 10, backgroundColor: c.bg, color: c.fg }}>
      {status}
    </span>
  );
};

export const ReferralsTab = () => {
  const { fetchReferralsAdmin, fetchReferralCostReport, blockReferralAdminAction, approveReferralAdminAction, triggerToast } = useAdmin();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [report, setReport] = useState(null);

  const load = async () => {
    setLoading(true);
    const [{ rows: r }, costReport] = await Promise.all([
      fetchReferralsAdmin({ status: status || undefined, search: search || undefined, limit: 50 }),
      fetchReferralCostReport(),
    ]);
    setRows(r);
    setReport(costReport);
    setLoading(false);
  };

  useEffect(() => { load(); }, [status]);

  const handleBlock = async (id) => {
    const reason = window.prompt('Reason for blocking this referral?');
    if (reason === null) return;
    const ok = await blockReferralAdminAction(id, reason);
    if (ok) load();
  };

  const handleApprove = async (id) => {
    const ok = await approveReferralAdminAction(id);
    if (ok) load();
  };

  return (
    <div style={{ padding: 24, fontFamily: "'Outfit', sans-serif" }}>
      <div style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: '#0f172a' }}>Referrals</h2>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#64748b' }}>
          Every referred signup, its qualification status, and Admin's coin liability for this program.
        </p>
      </div>

      {report && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
          {[
            { label: 'This Month — Coins Issued', value: `${report.thisMonth.coins.toLocaleString('en-IN')} coins`, sub: `≈ ₹${report.thisMonth.rupees.toLocaleString('en-IN')}` },
            { label: 'This Month — Payouts', value: report.thisMonth.payoutCount, sub: report.thisMonth.budgetRemainingCoins !== null ? `${report.thisMonth.budgetRemainingCoins} coins left of budget` : 'No budget cap set' },
            { label: 'All-Time — Coins Issued', value: `${report.allTime.coins.toLocaleString('en-IN')} coins`, sub: `≈ ₹${report.allTime.rupees.toLocaleString('en-IN')}` },
            { label: 'Successful Referrals', value: report.successfulReferrals, sub: `${report.milestonesPaid} milestone bonuses paid` },
          ].map((c) => (
            <div key={c.label} style={{ flex: 1, minWidth: 180, backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{c.label}</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: '#0f172a', marginTop: 6 }}>{c.value}</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{c.sub}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text" placeholder="Search by referrer name/phone…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
          style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, minWidth: 240 }}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, padding: '8px 12px', fontSize: 12.5 }}>
          <option value="">All statuses</option>
          {['PENDING', 'QUALIFIED', 'CREDITED', 'BLOCKED', 'EXPIRED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={load} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: '#0ea5e9', color: '#fff', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>
          Search
        </button>
      </div>

      <div style={{ marginTop: 16, backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc' }}>
                {['Referrer', 'Referee', 'Status', 'Reward', 'Created', 'Actions'].map((h) => (
                  <th key={h} style={{ padding: '11px 18px', textAlign: 'left', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', fontSize: 12.5, color: '#64748b' }}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', fontSize: 12.5, color: '#64748b' }}>No referrals found.</td></tr>
              ) : rows.map((r) => (
                <tr key={r._id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '11px 18px', fontSize: 12, fontWeight: 700, color: '#0f172a' }}>
                    {r.referrerId?.name || '—'}<br /><span style={{ fontSize: 10.5, color: '#94a3b8' }}>{r.referrerId?.phone}</span>
                  </td>
                  <td style={{ padding: '11px 18px', fontSize: 12, color: '#334155' }}>
                    {r.refereeId?.name || '—'}<br /><span style={{ fontSize: 10.5, color: '#94a3b8' }}>{r.refereeId?.phone}</span>
                  </td>
                  <td style={{ padding: '11px 18px' }}><StatusBadge status={r.status} /></td>
                  <td style={{ padding: '11px 18px', fontSize: 12, fontWeight: 700, color: '#0f172a' }}>
                    {r.rewardCoins || r.rewardConfigSnapshot?.perReferralCoins || 0} coins
                  </td>
                  <td style={{ padding: '11px 18px', fontSize: 11.5, color: '#64748b' }}>{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td style={{ padding: '11px 18px' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {r.status === 'QUALIFIED' && (
                        <button onClick={() => handleApprove(r._id)} style={{ fontSize: 11, fontWeight: 800, padding: '5px 10px', borderRadius: 8, border: 'none', backgroundColor: '#dcfce7', color: '#166534', cursor: 'pointer' }}>
                          Approve
                        </button>
                      )}
                      {['PENDING', 'QUALIFIED'].includes(r.status) && (
                        <button onClick={() => handleBlock(r._id)} style={{ fontSize: 11, fontWeight: 800, padding: '5px 10px', borderRadius: 8, border: 'none', backgroundColor: '#fee2e2', color: '#991b1b', cursor: 'pointer' }}>
                          Block
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ReferralsTab;
