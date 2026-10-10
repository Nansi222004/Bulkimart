import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';
import { NhcSellerBadge, sortNhcSellersFirst } from './NhcSellerBadge';

const WINDOWS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

/**
 * A headline number with a click-through to the screen that explains it.
 * `tone` carries meaning, not decoration: amber is a queue somebody has to
 * work through, red is something already going wrong.
 */
const Stat = ({ label, value, hint, tone = 'plain', onClick }) => {
  const tones = {
    plain: { bg: '#ffffff', border: '#e2e8f0', value: '#0f172a', hint: '#64748b' },
    good: { bg: '#ffffff', border: '#e2e8f0', value: '#15803d', hint: '#15803d' },
    warn: { bg: '#fffbeb', border: '#fde68a', value: '#b45309', hint: '#b45309' },
    bad: { bg: '#fef2f2', border: '#fecaca', value: '#b91c1c', hint: '#b91c1c' },
  };
  const t = tones[tone] || tones.plain;
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick(); } : undefined}
      style={{
        padding: '16px 18px', borderRadius: 12, backgroundColor: t.bg,
        border: `1px solid ${t.border}`, cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
        {label}
      </span>
      <div style={{ fontSize: 22, fontWeight: 900, color: value === null ? '#94a3b8' : t.value, margin: '4px 0' }}>
        {value === null ? '—' : value}
      </div>
      <span style={{ fontSize: 10.5, color: t.hint, fontWeight: 700 }}>{hint}</span>
    </div>
  );
};

const Panel = ({ title, action, children }) => (
  <div style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 20 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#0f172a' }}>{title}</h3>
      {action}
    </div>
    {children}
  </div>
);

export const VendorDashboardTab = () => {
  const {
    vendorDashboard, vendorDashboardLoading, vendorDashboardError,
    fetchVendorDashboard, setActiveTab,
  } = useAdmin();

  const [days, setDays] = useState(30);

  useEffect(() => { fetchVendorDashboard(days); }, [fetchVendorDashboard, days]);

  const roster = vendorDashboard?.roster;
  const catalogue = vendorDashboard?.catalogue;
  const trade = vendorDashboard?.trade;
  const topVendors = vendorDashboard?.topVendors || [];
  const pendingQueue = vendorDashboard?.pendingQueue || [];

  const linkBtn = (label, tab) => (
    <button
      type="button"
      onClick={() => setActiveTab(tab)}
      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11.5, fontWeight: 800, color: '#2563eb' }}
    >
      {label} →
    </button>
  );

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0f172a' }}>Vendor Ecosystem Dashboard</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#64748b' }}>
            Roster health, catalogue depth and trading activity across all registered general vendors.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              onClick={() => setDays(w.days)}
              style={{
                padding: '7px 12px', borderRadius: 8, fontSize: 11.5, fontWeight: 800, cursor: 'pointer',
                border: days === w.days ? '1.5px solid #2563eb' : '1.5px solid #e2e8f0',
                backgroundColor: days === w.days ? '#2563eb' : '#ffffff',
                color: days === w.days ? '#ffffff' : '#475569',
              }}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {vendorDashboardError && (
        <div style={{ padding: '10px 14px', borderRadius: 10, backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, fontWeight: 700 }}>
          {vendorDashboardError}
        </div>
      )}

      {/* Roster */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 14 }}>
        <Stat
          label="Approved Vendors"
          value={roster ? roster.approved : null}
          hint={vendorDashboardLoading ? 'Loading…' : 'Can sell right now'}
          tone="good"
          onClick={() => setActiveTab('vendors-approved')}
        />
        <Stat
          label="Pending Approval"
          value={roster ? roster.pending : null}
          hint={roster?.pending > 0 ? 'Waiting on you' : 'Queue is clear'}
          tone={roster?.pending > 0 ? 'warn' : 'plain'}
          onClick={() => setActiveTab('vendors-pending')}
        />
        <Stat
          label="Suspended"
          value={roster ? roster.suspended : null}
          hint="Blocked from selling"
          tone={roster?.suspended > 0 ? 'bad' : 'plain'}
          onClick={() => setActiveTab('vendors-suspended')}
        />
        <Stat
          label="Rejected"
          value={roster ? roster.rejected : null}
          hint="Applications turned down"
          onClick={() => setActiveTab('vendors-rejected')}
        />
        <Stat
          label="Incomplete Sign-ups"
          value={roster ? roster.incomplete : null}
          hint="Started, never submitted"
        />
        {/*
          An approved vendor with no storefront is invisible to shoppers —
          a different failure from not being approved, and one nothing else
          on the admin surface surfaces.
        */}
        <Stat
          label="No Storefront"
          value={roster ? roster.storefrontsMissing : null}
          hint="Approved but unbrowsable"
          tone={roster?.storefrontsMissing > 0 ? 'warn' : 'plain'}
          onClick={() => setActiveTab('stores-all')}
        />
      </div>

      {/* Catalogue + trade */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 14 }}>
        <Stat
          label="Live Listings"
          value={catalogue ? catalogue.live : null}
          hint={catalogue ? `of ${catalogue.total} total` : ''}
          onClick={() => setActiveTab('vendor-products')}
        />
        <Stat
          label="Awaiting Product Review"
          value={catalogue ? catalogue.pending : null}
          hint={catalogue?.pending > 0 ? 'Listings queued' : 'Nothing queued'}
          tone={catalogue?.pending > 0 ? 'warn' : 'plain'}
          onClick={() => setActiveTab('vendor-products')}
        />
        <Stat
          label="Out of Stock"
          value={catalogue ? catalogue.outOfStock : null}
          hint="Listed but unbuyable"
          tone={catalogue?.outOfStock > 0 ? 'warn' : 'plain'}
        />
        <Stat
          label={`Vendor Sales · ${days}d`}
          value={trade ? money(trade.sales) : null}
          hint="Delivered orders only"
        />
        <Stat
          label={`Orders Delivered · ${days}d`}
          value={trade ? trade.deliveredOrders : null}
          hint={trade ? `of ${trade.totalOrders} placed` : ''}
        />
        <Stat
          label="Vendors Trading"
          value={trade ? trade.sellingVendors : null}
          hint={trade?.activeRate === null || trade?.activeRate === undefined
            ? 'No approved vendors yet'
            : `${trade.activeRate}% of approved`}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>

        <Panel title={`Top Vendors · last ${days} days`} action={linkBtn('All vendors', 'vendors-all')}>
          {vendorDashboardLoading ? (
            <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>Loading…</p>
          ) : topVendors.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>No vendor sales in this window.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {topVendors.map((v, i) => (
                <div key={v.sellerId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i === topVendors.length - 1 ? 'none' : '1px solid #f1f5f9' }}>
                  <span style={{ fontSize: 11, fontWeight: 900, color: '#2563eb', width: 22 }}>#{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.name}
                    </div>
                    <div style={{ fontSize: 10.5, color: '#64748b' }}>
                      {[v.city, `${v.orders} order${v.orders === 1 ? '' : 's'}`, v.rating ? `${v.rating} ★` : null]
                        .filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>{money(v.sales)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Waiting for Approval" action={linkBtn('Review queue', 'vendors-pending')}>
          {vendorDashboardLoading ? (
            <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>Loading…</p>
          ) : pendingQueue.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12, color: '#15803d', fontWeight: 700 }}>
              Nothing waiting — every application has been reviewed.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {sortNhcSellersFirst(pendingQueue).map((v, i) => {
                const isNhc = Boolean(v.isNhcSeller || v.isNscSeller);
                return (
                  <div key={v.sellerId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i === pendingQueue.length - 1 ? 'none' : '1px solid #f1f5f9' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>{v.name}</span>
                        {isNhc && <NhcSellerBadge style={{ fontSize: '9.5px', padding: '1px 5px' }} />}
                      </div>
                      <div style={{ fontSize: 10.5, color: '#64748b' }}>
                        {[v.owner, v.city].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <span style={{ fontSize: 10.5, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                      {v.submittedAt ? new Date(v.submittedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

      </div>

    </div>
  );
};

export default VendorDashboardTab;
