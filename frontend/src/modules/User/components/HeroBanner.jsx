import React, { useEffect, useState } from 'react';
import { useStorefront } from '../context/StorefrontContext';
import StorefrontMedia, { useReducedMotion } from './StorefrontMedia';
import usePromotionNavigation from '../hooks/usePromotionNavigation';
import { apiUrl } from '../../../utils/api';
import defaultBanner from '../../../assets/banner1.webp';
import Celebration from './Celebration';
export default function HeroBanner() {
  const { banners, loading, device, now } = useStorefront();
  const [index, setIndex] = useState(0), [paused, setPaused] = useState(false), [hover, setHover] = useState(false);
  const reduced = useReducedMotion(), navigate = usePromotionNavigation();
  const current = index % Math.max(1, banners.length), banner = banners[current];
  // The page effect is drawn by the festive or top header; the hero only draws its own banner animation.
  const heroEffect = banner?.animation;
  useEffect(() => { if (banners.length < 2 || paused || hover || reduced || banner?.video) return; const timer = setInterval(() => setIndex(i => i + 1), 6000); return () => clearInterval(timer); }, [banners.length, paused, hover, reduced, banner?.video]);
  if (!banner) return loading ? <div className="sf-hero-skeleton" aria-label="Loading promotions" /> : <section className="sf-hero sf-hero-default" aria-label="Welcome to Bulkimart">
    <button type="button" className="sf-default-banner-link" aria-label="Explore products" onClick={() => navigate({ type: 'NAV', id: 'categories' })}>
      <img src={defaultBanner} alt="Bulkimart — Everyday finds. One smart shop. Discover products from shops and local sellers." width="1774" height="887" fetchPriority="high" />
    </button>
  </section>;
  const go = () => { fetch(apiUrl(`/api/banners/${banner.id}/click`), { method: 'POST' }).catch(() => {}); navigate(banner.destination); };
  return <section className="sf-hero" aria-roledescription="carousel" aria-label="Featured promotions" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocusCapture={() => setHover(true)} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget)) setHover(false); }}>
    {/* Tapping the picture opens the promotion too; the button below stays the keyboard route. Video controls keep working. */}
    <div className={`sf-hero-art${banner.destination.type !== 'NONE' ? ' sf-hero-art--link' : ''}`} onClick={banner.destination.type !== 'NONE' ? e => { if (e.target.tagName !== 'VIDEO') go(); } : undefined}>
      <StorefrontMedia key={banner.id} banner={banner} device={device} eager active={!paused} />
      <Celebration effect={paused ? null : heroEffect} now={now} />
      {banners.length > 1 && (
        <div className="sf-carousel-dots" aria-label="Slide dots">
          {banners.map((_, i) => (
            <button
              key={i}
              type="button"
              className={`sf-dot ${i === current ? 'active' : ''}`}
              aria-label={`Go to slide ${i + 1}`}
              onClick={e => { e.stopPropagation(); setIndex(i); }}
            />
          ))}
        </div>
      )}
    </div>
    <div className="sf-hero-copy"><span className="sf-eyebrow">DISCOVER SOMETHING GOOD</span><h2>{banner.title}</h2>{banner.subtitle && <p>{banner.subtitle}</p>}
      {banner.destination.type !== 'NONE' && <button className="sf-cta" onClick={go}>{banner.cta || 'Explore now'} <span aria-hidden="true">→</span></button>}
    </div>
  </section>;
}
