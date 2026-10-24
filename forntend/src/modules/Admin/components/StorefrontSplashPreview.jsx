import React, { useEffect, useRef, useState } from 'react';
import SplashCard from '../../User/components/SplashCard';

export default function StorefrontSplashPreview({ banner, config, device, endAt }) {
  const [playing, setPlaying] = useState(Boolean(banner)), [replay, setReplay] = useState(0), [now, setNow] = useState(Date.now);
  const stage = useRef(null), replayButton = useRef(null);
  const requestedDuration = Number(config.duration);
  const duration = Number.isFinite(requestedDuration) ? Math.min(15, Math.max(2, requestedDuration)) : 5;
  const bannerId = banner?._id || banner?.id;
  const dismiss = () => {
    if (stage.current?.contains(document.activeElement)) replayButton.current?.focus({ preventScroll: true });
    setPlaying(false);
  };
  useEffect(() => {
    setPlaying(Boolean(banner)); setNow(Date.now());
  }, [bannerId, banner?.image, banner?.mobileImage, banner?.video, device, duration, config.countdown, endAt]);
  useEffect(() => {
    if (!playing || !banner) return;
    const timer = setTimeout(dismiss, duration * 1000);
    const clock = config.countdown && endAt ? setInterval(() => setNow(Date.now()), 1000) : null;
    return () => { clearTimeout(timer); if (clock) clearInterval(clock); };
  }, [playing, replay, bannerId, banner?.image, banner?.mobileImage, banner?.video, device, duration, config.countdown, endAt]);
  const artwork = banner && { ...banner, id: bannerId,
    destination: banner.destination || { type: banner.actionType || 'NONE' } };
  return <section className="studio-splash-preview" aria-label="App launch splash preview">
    <div className="studio-splash-controls"><div><strong>App launch preview</strong><small>Auto-close after {duration} seconds</small></div>
      <button type="button" ref={replayButton} disabled={!banner} onClick={() => { setNow(Date.now()); setPlaying(true); setReplay(value => value + 1); }}>Replay splash</button>
    </div>
    <div ref={stage} className="studio-splash-stage" tabIndex={0} onKeyDown={event => {
      if (event.key === 'Escape' && playing) { event.stopPropagation(); dismiss(); }
    }}>
      <div className="studio-launch-underlay"><div className="studio-preview-header">BULKIMART<div className="studio-preview-search">Search products and categories</div></div>
        <p>{banner ? 'Your storefront continues after the splash closes.' : 'Select or upload a banner to preview your splash screen.'}</p>
      </div>
      {playing && artwork && <div className="sf-splash" aria-label="Splash appearance preview">
        <SplashCard banner={artwork} device={device} now={now} endAt={endAt} showCountdown={config.countdown} onNavigate={dismiss} />
      </div>}
    </div>
    <p className="studio-help">Preview only. Publish this campaign to show it on eligible customer app launches.</p>
  </section>;
}
