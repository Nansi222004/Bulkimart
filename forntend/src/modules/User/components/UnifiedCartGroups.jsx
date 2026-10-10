import React from 'react';
import { useUser } from '../context/UserContext';
import { useUnifiedCart } from '../hooks/useUnifiedCart';
import { formatCurrency } from '../utils/helpers';

/**
 * Everything in the basket, shown as the deliveries it will actually become.
 *
 * A shopper filling one cart from two shops is buying two journeys — a rider in
 * half an hour and a courier in three days — and the totals differ per journey.
 * Showing one flat list would hide that until checkout, which is late to learn
 * your speaker is not coming today.
 *
 * Read-only for now. Choosing a mode and placing the order stay where they are;
 * this is the composition layer made visible, not a replacement for the cart.
 *
 * Renders nothing when there is nothing to say — no basket, or a basket that is
 * all one journey and therefore already shown properly by the existing cart.
 */

const MODE_LABEL = {
  same_day: { icon: '⚡', text: 'Same-day', tone: '#166534', bg: '#dcfce7' },
  scheduled: { icon: '📦', text: 'Scheduled', tone: '#475569', bg: '#e2e8f0' },
};

const Row = ({ label, value, strong }) => (
  <div style={{
    display: 'flex', justifyContent: 'space-between', fontSize: strong ? 12.5 : 11.5,
    fontWeight: strong ? 800 : 600, color: strong ? 'var(--text-primary)' : 'var(--text-muted)',
    marginTop: 3,
  }}>
    <span>{label}</span>
    <span>{value}</span>
  </div>
);

const ModeButton = ({ active, busy, onClick, label }) => (
  <button
    type="button"
    disabled={busy}
    onClick={onClick}
    style={{
      flex: '1 1 auto', padding: '8px 10px', borderRadius: 8, cursor: busy ? 'wait' : 'pointer',
      fontSize: 11.5, fontWeight: 800, textAlign: 'center',
      border: `1.5px solid ${active ? 'var(--primary)' : 'var(--border-color)'}`,
      background: active ? 'var(--primary-light)' : 'transparent',
      color: active ? 'var(--primary)' : 'var(--text-primary)',
      opacity: busy ? 0.6 : 1,
    }}
  >
    {label}
  </button>
);

export const UnifiedCartGroups = ({ selectable = false, onChange }) => {
  const { getDeliveryPoint } = useUser();
  const { data, loading, setGroupMode } = useUnifiedCart(getDeliveryPoint());
  const [busy, setBusy] = React.useState(null);
  const [err, setErr] = React.useState('');

  const choose = async (group, mode) => {
    setBusy(group.key);
    setErr('');
    const res = await setGroupMode(group, mode);
    setBusy(null);
    if (!res.ok) setErr(res.message);
    else if (onChange) onChange();
  };

  React.useEffect(() => { if (data && onChange) onChange(data); }, [data]);

  if (loading || !data) return null;
  // One shop, one way of arriving — the ordinary cart already shows this well.
  if ((data.groups || []).length < 2) return null;

  return (
    <div className="profile-menu-card" style={{ padding: 16, marginBottom: 12 }}>
      <div style={{
        fontWeight: 800, fontSize: 12, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
      }}>
        Arriving separately
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>
        Your basket comes from {data.groups.length} deliveries. Each is charged for its own trip.
      </div>

      {data.groups.map((g) => {
        const mode = g.deliveryMode ? MODE_LABEL[g.deliveryMode] : null;
        return (
          <div key={g.key} style={{
            border: '1.5px solid var(--border-color)', borderRadius: 10,
            padding: 12, marginBottom: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text-primary)' }}>
                {g.seller?.name || (g.channel === 'grocery' ? 'Quick Commerce' : 'Store')}
              </span>
              {mode ? (
                <span style={{
                  fontSize: 9.5, fontWeight: 800, padding: '2px 7px', borderRadius: 5,
                  background: mode.bg, color: mode.tone, whiteSpace: 'nowrap',
                }}>
                  {mode.icon} {mode.text}
                </span>
              ) : (
                <span style={{
                  fontSize: 9.5, fontWeight: 800, padding: '2px 7px', borderRadius: 5,
                  background: 'var(--primary-light)', color: 'var(--primary)',
                }}>
                  ⚡ Quick
                </span>
              )}
            </div>

            {/* Both options for this group, and never a Same-Day one that is
                not actually on offer — a disabled row saying "unavailable" is
                just an explanation nobody asked for. */}
            {selectable && g.channel !== 'grocery' && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                {g.sameDayOption?.available === true && (
                  <ModeButton
                    active={g.deliveryMode === 'same_day'}
                    busy={busy === g.key}
                    onClick={() => choose(g, 'same_day')}
                    label={`⚡ Same-day  +${formatCurrency((g.sameDayFee || 0) + (g.sellerIncentive || 0))}`}
                  />
                )}
                <ModeButton
                  active={g.deliveryMode === 'scheduled' && g.modeChosen}
                  busy={busy === g.key}
                  onClick={() => choose(g, 'scheduled')}
                  label="📦 Scheduled"
                />
              </div>
            )}

            {selectable && g.channel !== 'grocery' && !g.modeChosen && (
              <div style={{ fontSize: 10.5, color: '#b45309', marginBottom: 8, fontWeight: 700 }}>
                Choose how these items should arrive
              </div>
            )}

            {g.items.map((it) => (
              <div key={String(it.productId)} style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: 12, color: 'var(--text-primary)', marginBottom: 3,
              }}>
                <span style={{ opacity: it.available ? 1 : 0.5 }}>
                  {it.qty}× {it.name}
                  {!it.available && ' — unavailable'}
                </span>
                <span style={{ fontWeight: 700 }}>{formatCurrency(it.lineTotal)}</span>
              </div>
            ))}

            <div style={{ borderTop: '1px solid var(--border-color)', marginTop: 8, paddingTop: 6 }}>
              <Row label="Items" value={formatCurrency(g.subtotal)} />
              {/* The premium is shown apart from the ordinary charge, because
                  they are two different things the customer is paying for. */}
              {g.standardFee > 0 && <Row label="Delivery" value={formatCurrency(g.standardFee)} />}
              {(g.sameDayFee > 0 || g.sellerIncentive > 0) && (
                <Row label="Same-day" value={formatCurrency((g.sameDayFee || 0) + (g.sellerIncentive || 0))} />
              )}
              <Row label="Group total" value={formatCurrency(g.total)} strong />
            </div>
          </div>
        );
      })}

      {err && (
        <div style={{ fontSize: 11.5, color: '#b91c1c', marginBottom: 8, fontWeight: 600 }}>{err}</div>
      )}

      <div style={{ borderTop: '1.5px solid var(--border-color)', marginTop: 4, paddingTop: 10 }}>
        <Row label="Subtotal" value={formatCurrency(data.totals.subtotal)} />
        <Row label="Delivery, all groups" value={formatCurrency(data.totals.deliveryCharge)} />
        <Row label="Payable" value={formatCurrency(data.totals.totalAmount)} strong />
      </div>
    </div>
  );
};

export default UnifiedCartGroups;
