import React, { useEffect, useState } from 'react';
import './CouponSuccessCelebration.css';

export default function CouponSuccessCelebration({ event }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!event) return undefined;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 2600);
    return () => clearTimeout(timer);
  }, [event?.id]);
  if (!event || !visible) return null;
  return <div className="coupon-celebration" role="status" aria-live="polite">
    <div className="coupon-celebration-confetti" aria-hidden="true">
      {Array.from({ length: 18 }, (_, index) => <span key={index} style={{ '--delay': `${index * 30}ms`, '--left': `${8 + index * 4.7}%`, '--drift': `${(index - 9) * 8}px` }} />)}
    </div>
    <p>Coupon {event.code} applied! {event.savings > 0 ? `You saved ₹${Number(event.savings).toLocaleString('en-IN', { maximumFractionDigits: 2 })}.` : 'Your benefit is ready.'}</p>
  </div>;
}
