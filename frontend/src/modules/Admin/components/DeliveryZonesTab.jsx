import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';

const STATUS_STYLE = {
  Active: { color: '#15803d', background: '#f0fdf4', border: '#bbf7d0' },
  Offline: { color: '#b45309', background: '#fffbeb', border: '#fde68a' },
  Inactive: { color: '#64748b', background: '#f8fafc', border: '#e2e8f0' },
};

const StatusPill = ({ value }) => {
  const s = STATUS_STYLE[value] || STATUS_STYLE.Inactive;
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 999,
      color: s.color, backgroundColor: s.background, border: `1.5px solid ${s.border}`,
    }}>
      {value}
    </span>
  );
};

/**
 * Delivery Hub Zones.
 *
 * A zone is a serviceable pincode, which is what dispatch actually falls back
 * to when the geo search finds nobody — not a record an admin creates. That is
 * why this screen reports coverage and has no "add zone" action: a zone comes
 * into existence when a rider declares they will serve it.
 */
export const DeliveryZonesTab = () => {
  const {
    deliveryZones, deliveryZonesLoading, deliveryZonesError, fetchDeliveryZones,
  } = useAdmin();

  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  // Debounced so typing in the search box doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      fetchDeliveryZones({
        state: stateFilter || undefined,
        city: cityFilter || undefined,
        search: search || undefined,
        status: statusFilter,
      });
    }, 250);
    return () => clearTimeout(t);
  }, [fetchDeliveryZones, search, stateFilter, cityFilter, statusFilter]);

  const zones = deliveryZones?.zones || [];
  const states = deliveryZones?.filters?.states || [];
  const cities = deliveryZones?.filters?.cities || [];
  const totals = deliveryZones?.totals;

  const exportCsv = () => {
    const header = ['Zone Code', 'Zone Name', 'City', 'State', 'Stores', 'Riders', 'Active Riders', 'Radius (km)', 'Status'];
    const lines = zones.map((z) => [
      z.zoneCode, z.zoneName || '', z.city || '', z.state || '', z.storeCount,
      z.riders, z.activeRiders, z.radiusKm ?? '', z.status,
    ]);
    // Quote every field — a store or city name containing a comma would
    // otherwise shift every column after it by one. Store names are typed by
    // sellers, so a leading = + - @ is written as text, never run as a formula.
    const csv = [header, ...lines]
      .map((row) => row.map((cell) => {
        const text = String(cell);
        return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
      }).join(','))
      .join('\r\n');

    const url = URL.createObjectURL(new Blob([`﻿${csv}\r\n`], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `delivery-hub-zones-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding: '20px 24px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--sa-text-primary)' }}>Delivery Hub Zones</h2>
            <span style={{ fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 12, backgroundColor: 'var(--sa-primary-glow)', color: 'var(--sa-primary)' }}>
              {zones.length} Zone{zones.length === 1 ? '' : 's'}
            </span>
            {totals?.activeZones > 0 && (
              <span style={{ fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 12, backgroundColor: '#f0fdf4', color: '#15803d' }}>
                {totals.activeZones} with riders online
              </span>
            )}
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: 11.5, color: 'var(--sa-text-secondary)' }}>
            Pincodes riders have signed up to cover, plus approved-store pincodes no rider covers yet (Inactive).
            {deliveryZones?.defaultRadiusKm
              ? ` Riders without their own limit are dispatched up to ${deliveryZones.defaultRadiusKm} km.`
              : ''}
          </p>
        </div>

        <button
          className="sa-btn-primary"
          style={{ backgroundColor: '#ffffff', color: 'var(--sa-text-primary)', border: '1px solid var(--sa-border)' }}
          onClick={exportCsv}
          disabled={zones.length === 0}
        >
          Export CSV
        </button>
      </div>

      {deliveryZonesError && (
        <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 16, backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, fontWeight: 700 }}>
          {deliveryZonesError}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, backgroundColor: '#ffffff', padding: 12, borderRadius: 10, border: '1px solid var(--sa-border)', flexWrap: 'wrap' }}>
        <div className="sa-search-wrapper" style={{ flex: 1, minWidth: 220, width: 'auto' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--sa-text-muted)" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="sa-search-input"
            placeholder="Filter by pincode, area, city or state..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          className="sa-select"
          value={stateFilter}
          onChange={(e) => {
            setStateFilter(e.target.value);
            // A city from the previous state would match nothing and leave the
            // table mysteriously empty.
            setCityFilter('');
          }}
        >
          <option value="">All States</option>
          {states.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <select className="sa-select" value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}>
          <option value="">All Cities</option>
          {cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <select className="sa-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="All">All Statuses</option>
          <option value="Active">Active — riders online</option>
          <option value="Offline">Offline — riders, none online</option>
          <option value="Inactive">Inactive — no riders</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid var(--sa-border)', overflow: 'hidden' }}>
        <div tabIndex={0} role="region" aria-label="Scrollable data table" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--sa-border)' }}>
                {['Zone Code', 'Zone Name', 'State', 'Stores In Zone', 'Riders', 'Active Riders', 'Radius (km)', 'Status'].map((col) => (
                  <th key={col} style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {deliveryZonesLoading ? (
                <tr>
                  <td colSpan={8} style={{ padding: '30px', textAlign: 'center', color: 'var(--sa-text-muted)', fontSize: 12 }}>
                    Loading zones…
                  </td>
                </tr>
              ) : zones.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '30px', textAlign: 'center', color: 'var(--sa-text-muted)', fontSize: 12 }}>
                    {search || stateFilter || cityFilter || statusFilter !== 'All'
                      ? 'No zones match these filters.'
                      : 'No zones yet — a pincode appears here once an approved rider lists it or an approved store is located in it.'}
                  </td>
                </tr>
              ) : (
                zones.map((z, idx) => (
                  <tr key={z.zoneCode} style={{ borderBottom: idx === zones.length - 1 ? 'none' : '1px solid var(--sa-border)' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 800, color: 'var(--sa-text-primary)' }}>{z.zoneCode}</td>
                    <td style={{ padding: '12px 16px', fontWeight: 700, color: z.zoneName ? 'var(--sa-text-primary)' : 'var(--sa-text-muted)' }}>
                      {z.zoneName || '—'}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--sa-text-secondary)' }}>{z.state || '—'}</td>
                    <td style={{ padding: '12px 16px', color: 'var(--sa-text-secondary)' }}>
                      {z.storeCount === 0 ? '—' : (
                        <>
                          <strong>{z.storeCount}</strong>
                          <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--sa-text-muted)' }}>
                            {z.stores.join(', ')}{z.storeCount > z.stores.length ? '…' : ''}
                          </span>
                        </>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--sa-text-secondary)' }}>{z.riders}</td>
                    <td style={{ padding: '12px 16px', fontWeight: 800, color: z.activeRiders > 0 ? '#15803d' : 'var(--sa-text-muted)' }}>
                      {z.activeRiders}
                    </td>
                    <td style={{ padding: '12px 16px', color: z.radiusKm === null ? 'var(--sa-text-muted)' : 'var(--sa-text-secondary)' }}>
                      {z.riders === 0 ? '—' : z.radiusKm === null ? 'Platform default' : `${z.radiusKm} km`}
                    </td>
                    <td style={{ padding: '12px 16px' }}><StatusPill value={z.status} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};

export default DeliveryZonesTab;
