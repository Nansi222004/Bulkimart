import React from 'react';
import Celebration from './Celebration';
import { useStorefront } from '../context/StorefrontContext';
import usePromotionNavigation from '../hooks/usePromotionNavigation';
import { DEFAULT_HEADER, DEFAULT_COUNTDOWN, countdownState, countdownParts, headerDestination } from '../../../utils/storefront';
const pad = n => String(n).padStart(2, '0');
export const normalizeHeader = header => header ? { ...DEFAULT_HEADER, ...header, countdown: { ...DEFAULT_COUNTDOWN, ...header.countdown } } : null;
export const hasFestiveHeader = theme => { const header = normalizeHeader(theme?.header); return !!(header?.enabled && header.title); };

// The countdown is not a live region: announcing every second would be noise.
export function FestiveCountdown({ countdown, now }) {
  const state = countdownState(countdown, now);
  if (state.phase === 'off' || (state.phase === 'after' && !countdown.expiredText)) return null;
  if (state.phase === 'after') return <p className="sf-festive-countdown sf-festive-countdown--ended">{countdown.expiredText}</p>;
  if (state.phase === 'live') return <p className="sf-festive-countdown"><span>{countdown.title || 'Sale is live'}</span></p>;
  const { days, hours, minutes, seconds } = countdownParts(state.remaining), label = state.phase === 'before' ? 'Starts in' : 'Ends in';
  return <p className="sf-festive-countdown" data-phase={state.phase}>
    <span>{countdown.title ? `${countdown.title} · ${label}` : label}</span>
    <time dateTime={new Date(state.target).toISOString()}>{days > 0 && <><b>{days}</b>d </>}<b>{pad(hours)}</b>:<b>{pad(minutes)}</b>:<b>{pad(seconds)}</b></time>
  </p>;
}

// Layers, bottom to top: header background, decorative canvas, copy and controls.
// The section clips the canvas; nothing decorative reaches the rest of the page.
export function FestiveHeader({ header, effect, now, preview = false, onNavigate }) {
  const destination = headerDestination(header);
  return <section className="sf-festive" aria-label={header.title || 'Festive offers'} data-preview={preview || undefined}
    style={{ '--sf-festive-bg': header.background, '--sf-festive-text': header.text, '--sf-festive-height': `${header.height}px` }}>
    <Celebration effect={effect} now={now} preview={preview} />
    <div className="sf-festive-content">
      <div className="sf-festive-copy">
        <h2>{header.title}</h2>
        {header.subtitle && <p>{header.subtitle}</p>}
        <FestiveCountdown countdown={header.countdown} now={now} />
        {destination.type !== 'NONE' && header.cta && <button type="button" className="sf-cta" onClick={() => onNavigate?.(destination)}>{header.cta} <span aria-hidden="true">→</span></button>}
      </div>
      {header.image && <img className="sf-festive-art" src={header.image} alt="" />}
    </div>
  </section>;
}

export default function StorefrontFestiveHeader() {
  const { theme, effect, now } = useStorefront(), navigate = usePromotionNavigation();
  const header = normalizeHeader(theme.header);
  return hasFestiveHeader(theme) ? <FestiveHeader header={header} effect={effect} now={now} onNavigate={navigate} /> : null;
}
