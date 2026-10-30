import React, { useEffect, useRef, useState } from 'react';
import './CouponSuccessCelebration.css';

export default function CouponSuccessCelebration({ event, active = true }) {
  const [visible, setVisible] = useState(false);
  const playback = useRef(null);
  useEffect(() => {
    if (!event || !active) {
      setVisible(false);
      if (playback.current?.id === event?.id && playback.current) playback.current.completed = true;
      return undefined;
    }
    if (playback.current?.id !== event.id) playback.current = { id: event.id, startedAt: Date.now(), completed: false };
    const remaining = 2600 - (Date.now() - playback.current.startedAt);
    if (playback.current.completed || remaining <= 0) { setVisible(false); return undefined; }
    setVisible(true);
    const timer = setTimeout(() => { playback.current.completed = true; setVisible(false); }, remaining);
    return () => clearTimeout(timer);
  }, [event?.id, active]);
  if (!event || !active || !visible) return null;
  return <div className="coupon-celebration" role="status" aria-live="polite">
    <div className="coupon-celebration-confetti" aria-hidden="true">
      {Array.from({ length: 18 }, (_, index) => <span key={index} style={{ '--delay': `${index * 30}ms`, '--left': `${8 + index * 4.7}%`, '--drift': `${(index - 9) * 8}px` }} />)}
    </div>
    <p>Coupon {event.code} applied! {event.savings > 0 ? `You saved ₹${Number(event.savings).toLocaleString('en-IN', { maximumFractionDigits: 2 })}.` : 'Your benefit is ready.'}</p>
  </div>;
}
