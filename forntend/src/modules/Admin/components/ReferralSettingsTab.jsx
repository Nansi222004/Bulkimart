import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';

/**
 * Admin — Referral Program settings. Same insert-not-edit pattern as
 * RadiusSettingsTab: saving here creates a new active ReferralConfig row
 * and never edits one in place, so a past change stays auditable.
 *
 * Every reward number here is in COINS. Admin bears the full cost of every
 * coin issued under this program — this screen is where that liability is
 * actually set; the Referrals tab's cost report shows what it has added
 * up to so far.
 */

const FieldRow = ({ label, hint, value, onChange, suffix = 'coins', min = 0 }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 220 }}>
    <label style={{ fontSize: 10.5, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
      {label}
    </label>
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      border: '1.5px solid #cbd5e1', borderRadius: 8, padding: '9px 10px', backgroundColor: '#fff',
    }}>
      <input
        type="number" min={min} step="1" value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ border: 'none', outline: 'none', fontSize: 13, fontWeight: 700, width: '100%', color: '#0f172a' }}
      />
      <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', whiteSpace: 'nowrap' }}>{suffix}</span>
    </div>
    <span style={{ fontSize: 10.5, color: '#94a3b8' }}>{hint}</span>
  </div>
);

const DEFAULT_MILESTONES = [
  { count: 5, bonusCoins: 500 },
  { count: 10, bonusCoins: 1000 },
  { count: 25, bonusCoins: 2500 },
  { count: 50, bonusCoins: 5000 },
];

export const ReferralSettingsTab = () => {
  const { fetchReferralSettings, setReferralSettings, triggerToast } = useAdmin();
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');

  const [isEnabled, setIsEnabled] = useState(true);
  const [perReferralCoins, setPerReferralCoins] = useState('100');
  const [milestones, setMilestones] = useState(DEFAULT_MILESTONES);
  const [minQualifyingOrderValue, setMinQualifyingOrderValue] = useState('299');
  const [refereeRewardCoins, setRefereeRewardCoins] = useState('50');
  const [referralValidityDays, setReferralValidityDays] = useState('30');
  const [maxReferralsPerUserPerMonth, setMaxReferralsPerUserPerMonth] = useState('50');
  const [monthlyBudgetCoins, setMonthlyBudgetCoins] = useState('0');
  const [requireManualApprovalAbove, setRequireManualApprovalAbove] = useState('0');

  const load = async () => {
    setLoading(true);
    const data = await fetchReferralSettings();
    if (data) {
      setCurrent(data.current || null);
      setHistory(data.history || []);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!current) return;
    setIsEnabled(Boolean(current.isEnabled));
    setPerReferralCoins(String(current.perReferralCoins ?? ''));
    setMilestones(current.milestones?.length ? current.milestones : DEFAULT_MILESTONES);
    setMinQualifyingOrderValue(String(current.minQualifyingOrderValue ?? ''));
    setRefereeRewardCoins(String(current.refereeRewardCoins ?? '50'));
    setReferralValidityDays(String(current.referralValidityDays ?? ''));
    setMaxReferralsPerUserPerMonth(String(current.maxReferralsPerUserPerMonth ?? '0'));
    setMonthlyBudgetCoins(String(current.monthlyBudgetCoins ?? '0'));
    setRequireManualApprovalAbove(String(current.requireManualApprovalAbove ?? '0'));
  }, [current]);

  const updateMilestone = (idx, field, value) => {
    setMilestones((prev) => prev.map((m, i) => (i === idx ? { ...m, [field]: value } : m)));
  };

  const save = async () => {
    if (!perReferralCoins || Number(perReferralCoins) <= 0) {
      triggerToast('Per-referral coins must be greater than 0');
      return;
    }
    setSaving(true);
    const ok = await setReferralSettings({
      isEnabled,
      perReferralCoins: Number(perReferralCoins),
      milestones: milestones.map((m) => ({ count: Number(m.count), bonusCoins: Number(m.bonusCoins) })),
      minQualifyingOrderValue: Number(minQualifyingOrderValue),
      refereeRewardCoins: Number(refereeRewardCoins || 0),
      referralValidityDays: Number(referralValidityDays),
      maxReferralsPerUserPerMonth: Number(maxReferralsPerUserPerMonth || 0),
      monthlyBudgetCoins: Number(monthlyBudgetCoins || 0),
      requireManualApprovalAbove: Number(requireManualApprovalAbove || 0),
      note: note || undefined,
    });
    setSaving(false);
    if (ok) { setNote(''); await load(); }
  };

  return (
    <div style={{ padding: 24, fontFamily: "'Outfit', sans-serif" }}>
      <div style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: '#0f172a' }}>Referral Program Settings</h2>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#64748b' }}>
          Every reward is paid in Bulkimart Coins and fully funded by Admin. Rewards are earned
          only once the referred friend's FIRST order is delivered, meets the minimum value,
          and its return window has closed with no active return.
        </p>
      </div>

      {loading ? (
        <p style={{ fontSize: 13, color: '#64748b', padding: '30px 0' }}>Loading&hellip;</p>
      ) : (
        <div style={{
          backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16,
          padding: 18, display: 'flex', flexDirection: 'column', gap: 16, marginTop: 18, maxWidth: 820,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: isEnabled ? '#22c55e' : '#ef4444' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#0f172a' }}>Referral Program</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Disabling stops all new attribution and payouts instantly.</div>
            </div>
            <button
              type="button"
              onClick={() => setIsEnabled((v) => !v)}
              style={{
                padding: '8px 16px', borderRadius: 20, border: 'none', fontSize: 11.5, fontWeight: 800,
                cursor: 'pointer', backgroundColor: isEnabled ? '#dcfce7' : '#fee2e2',
                color: isEnabled ? '#166534' : '#991b1b',
              }}
            >
              {isEnabled ? 'ENABLED' : 'DISABLED'}
            </button>
            {current?.source === 'default' && (
              <span style={{ fontSize: 9.5, fontWeight: 800, padding: '3px 8px', borderRadius: 10, backgroundColor: '#fef3c7', color: '#92400e' }}>
                NOT CONFIGURED — USING DEFAULT
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <FieldRow label="Per-Referral Reward" hint="Coins credited to the referrer for one successful referral." value={perReferralCoins} onChange={setPerReferralCoins} />
            <FieldRow label="Minimum Qualifying Order Value" hint="Referee's first order must be at least this ₹ value." value={minQualifyingOrderValue} onChange={setMinQualifyingOrderValue} suffix="₹" />
            <FieldRow label="Referee Reward" hint="Coins credited to the FRIEND too — only once their own first order is delivered, above minimum, and its return window closes. Not an instant signup bonus. 0 = disabled." value={refereeRewardCoins} onChange={setRefereeRewardCoins} />
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <FieldRow label="Referral Validity" hint="Days the referee has to place a qualifying order." value={referralValidityDays} onChange={setReferralValidityDays} suffix="days" min={1} />
            <FieldRow label="Max Referrals / User / Month" hint="Velocity cap. 0 = unlimited." value={maxReferralsPerUserPerMonth} onChange={setMaxReferralsPerUserPerMonth} />
            <FieldRow label="Monthly Budget" hint="Hard stop on Admin's coin liability per month. 0 = unlimited." value={monthlyBudgetCoins} onChange={setMonthlyBudgetCoins} />
            <FieldRow label="Manual Approval Threshold" hint="A single payout at/above this is held for admin approval. 0 = never." value={requireManualApprovalAbove} onChange={setRequireManualApprovalAbove} />
          </div>

          <div>
            <label style={{ fontSize: 10.5, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 8 }}>
              Milestone Bonuses
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {milestones.map((m, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, color: '#64748b', width: 90 }}>At</span>
                  <input type="number" min="1" value={m.count} onChange={(e) => updateMilestone(idx, 'count', e.target.value)}
                    style={{ width: 70, border: '1.5px solid #cbd5e1', borderRadius: 8, padding: '7px 8px', fontSize: 12.5, fontWeight: 700 }} />
                  <span style={{ fontSize: 12, color: '#64748b' }}>referrals, bonus</span>
                  <input type="number" min="1" value={m.bonusCoins} onChange={(e) => updateMilestone(idx, 'bonusCoins', e.target.value)}
                    style={{ width: 90, border: '1.5px solid #cbd5e1', borderRadius: 8, padding: '7px 8px', fontSize: 12.5, fontWeight: 700 }} />
                  <span style={{ fontSize: 12, color: '#64748b' }}>coins</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 10.5, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              Note (optional)
            </label>
            <input
              type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this change?"
              style={{ border: '1.5px solid #cbd5e1', borderRadius: 8, padding: '9px 10px', fontSize: 12.5, outline: 'none' }}
            />
          </div>

          <button
            type="button" disabled={saving} onClick={save}
            style={{
              alignSelf: 'flex-start', padding: '10px 22px', borderRadius: 10, border: 'none',
              fontSize: 12.5, fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer',
              backgroundColor: saving ? '#e2e8f0' : '#0ea5e9', color: saving ? '#94a3b8' : '#ffffff',
            }}
          >
            {saving ? 'Saving…' : 'Save referral settings'}
          </button>
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 18, backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16, overflow: 'hidden', maxWidth: 900 }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: 12.5, fontWeight: 900, color: '#0f172a' }}>Change history</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc' }}>
                  {['Per Referral', 'Min Order', 'Budget/mo', 'From', 'Changed by'].map((h) => (
                    <th key={h} style={{ padding: '11px 18px', textAlign: 'left', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r._id} style={{ borderTop: '1px solid #f1f5f9', opacity: r.isActive ? 1 : 0.55 }}>
                    <td style={{ padding: '11px 18px', fontSize: 12, fontWeight: 800, color: '#0f172a' }}>
                      {r.perReferralCoins} coins
                      {r.isActive && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 8, backgroundColor: '#dcfce7', color: '#166534' }}>LIVE</span>}
                    </td>
                    <td style={{ padding: '11px 18px', fontSize: 12, color: '#334155' }}>₹{r.minQualifyingOrderValue}</td>
                    <td style={{ padding: '11px 18px', fontSize: 12, color: '#334155' }}>{r.monthlyBudgetCoins > 0 ? `${r.monthlyBudgetCoins} coins` : 'Unlimited'}</td>
                    <td style={{ padding: '11px 18px', fontSize: 11.5, color: '#64748b' }}>{new Date(r.effectiveFrom || r.createdAt).toLocaleString()}</td>
                    <td style={{ padding: '11px 18px', fontSize: 11.5, color: '#64748b' }}>{r.updatedBy?.name || r.updatedBy?.email || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReferralSettingsTab;
