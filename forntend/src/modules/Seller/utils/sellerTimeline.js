// Payment verification appears in the payment summary, not as a second
// order placement or another fulfillment stage.
export const sellerTimeline = timeline => (timeline || []).filter(event =>
  !(event.status === 'placed' && /^online payment verified\.?$/i.test(String(event.note || '').trim())));
