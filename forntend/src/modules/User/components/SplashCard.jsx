import React from 'react';
import StorefrontMedia from './StorefrontMedia';
import Celebration from './Celebration';
import { countdown } from '../../../utils/storefront';

// Shared presentation for the real customer splash and the admin launch preview.
// Frequency, publication and navigation remain the responsibility of the host.
// `onSkip` is passed for a long splash, so the customer can close it before the time runs out.
export default function SplashCard({ banner, device, now, endAt, showCountdown, onNavigate, onSkip }) {
  return <div className="sf-splash-card">
    {onSkip && <button type="button" className="sf-splash-skip" onClick={onSkip}>Skip</button>}
    <StorefrontMedia banner={banner} device={device} eager />
    <Celebration effect={banner.animation} now={now} />
    {(showCountdown && endAt || banner.destination?.type && banner.destination.type !== 'NONE') && <div className="sf-splash-actions">
      {showCountdown && endAt && <p>Ends in <time>{countdown(endAt, now)}</time></p>}
      {banner.destination?.type && banner.destination.type !== 'NONE' && <button type="button" className="sf-cta" onClick={() => onNavigate?.(banner.destination)}>{banner.cta || 'Explore now'} →</button>}
    </div>}
  </div>;
}
