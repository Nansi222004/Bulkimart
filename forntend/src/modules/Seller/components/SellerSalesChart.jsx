import React, { useState } from 'react';

const money = amount => `₹${Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export default function SellerSalesChart({ data = [] }) {
  const [range, setRange] = useState(30), [hovered, setHovered] = useState(null);
  const points = data.slice(-range);
  const maximum = Math.max(1, ...points.map(point => point.revenue));
  const x = index => 15 + index * 320 / Math.max(1, points.length - 1);
  const y = revenue => 105 - revenue * 85 / maximum;
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${x(index)},${y(point.revenue)}`).join(' ');
  const selected = hovered === null ? null : points[hovered];
  return <div className="chart-section-card seller-sales-chart" style={{ margin: 0 }}>
    <div className="chart-header">
      <h3 className="chart-title">SALES PERFORMANCE</h3>
      <div className="chart-time-filter" aria-label="Sales period">
        {[30, 7].map(days => <button key={days} type="button" className={`chart-time-btn ${range === days ? 'active' : ''}`} aria-pressed={range === days} onClick={() => { setRange(days); setHovered(null); }}>{days} Days</button>)}
      </div>
    </div>
    <div className="seller-chart-tooltip" role="status">
      {selected ? `${new Date(`${selected.date}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}: ${money(selected.revenue)}` : 'Hover, tap or focus a day to see completed sales'}
    </div>
    <div className="chart-svg-container">
      <svg viewBox="0 0 350 120" role="group" aria-label="Daily completed product sales" onMouseLeave={() => setHovered(null)}>
        <line x1="15" y1="105" x2="335" y2="105" stroke="#e2e8f0" />
        <path d={path} fill="none" stroke="#1b7a37" strokeWidth="3" />
        {selected && <g pointerEvents="none"><line x1={x(hovered)} x2={x(hovered)} y1="10" y2="105" stroke="#64748b" strokeDasharray="3 3" /><circle cx={x(hovered)} cy={y(selected.revenue)} r="4" fill="#fff" stroke="#1b7a37" strokeWidth="2" /></g>}
        {points.map((point, index) => <rect key={point.date} className="seller-chart-hit" x={x(index) - 160 / Math.max(1, points.length - 1)} y="0" width={320 / Math.max(1, points.length - 1)} height="120" fill="transparent" tabIndex="0" role="button" aria-label={`${point.date}: ${money(point.revenue)}`} onMouseEnter={() => setHovered(index)} onFocus={() => setHovered(index)} onBlur={() => setHovered(null)} onClick={() => setHovered(index)} onKeyDown={event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); setHovered(index); } }} />)}
      </svg>
    </div>
    {!points.length && <p>No completed sales data available.</p>}
    {!!points.length && !points.some(point => point.revenue > 0) && <p>No completed sales in this period.</p>}
  </div>;
}
