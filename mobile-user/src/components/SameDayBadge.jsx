// Port of SameDayBadge.jsx: shown only when the server's verdict says same-day is available.
import React from 'react';
import { Text } from './ui';

export function SameDayBadge({ verdict, compact = false }) {
  if (!verdict?.available) return null;
  const label = verdict.promisedBy
    ? `Expected by ${new Date(verdict.promisedBy).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`
    : 'Same-day delivery available';
  return <Text accessibilityLabel={label} style={{ alignSelf: 'flex-start', backgroundColor: '#dcfce7', color: '#166534', borderRadius: 6, paddingVertical: compact ? 2 : 3, paddingHorizontal: compact ? 6 : 8, fontSize: compact ? 9 : 10, fontWeight: '800', letterSpacing: 0.2, marginTop: 4, overflow: 'hidden' }}>⚡ Same-day</Text>;
}
export default SameDayBadge;
